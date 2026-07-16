use rusqlite::{Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

pub struct Database {
    pub path: PathBuf,
    lock: Mutex<()>,
}

impl Database {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "Dossier de données introuvable".to_string())?;
        fs::create_dir_all(&dir)
            .map_err(|_| "Impossible de créer le dossier de données".to_string())?;
        let db = Self {
            path: dir.join("maktaba-pos.sqlite3"),
            lock: Mutex::new(()),
        };
        db.migrate()?;
        Ok(db)
    }
    #[cfg(test)]
    pub fn temporary(path: PathBuf) -> Result<Self, String> {
        let db = Self {
            path,
            lock: Mutex::new(()),
        };
        db.migrate()?;
        Ok(db)
    }
    pub fn guard(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.lock
            .lock()
            .map_err(|_| "Base de données occupée".into())
    }
    pub fn connect(&self) -> Result<Connection, String> {
        let c = Connection::open(&self.path)
            .map_err(|_| "Impossible d’ouvrir la base de données".to_string())?;
        c.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
        )
        .map_err(|_| "Configuration SQLite impossible".to_string())?;
        Ok(c)
    }
    fn migrate(&self) -> Result<(), String> {
        let c = self.connect()?;
        c.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);").map_err(|_|"Initialisation impossible".to_string())?;
        let done: Option<i64> = c
            .query_row(
                "SELECT version FROM schema_migrations WHERE version=1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Migration impossible".to_string())?;
        if done.is_none() {
            let tx = c
                .unchecked_transaction()
                .map_err(|_| "Migration impossible".to_string())?;
            tx.execute_batch(SCHEMA)
                .map_err(|_| "Création du schéma impossible".to_string())?;
            tx.execute(
                "INSERT INTO schema_migrations(version,name) VALUES(1,'initial_schema')",
                [],
            )
            .map_err(|_| "Migration impossible".to_string())?;
            tx.commit()
                .map_err(|_| "Migration impossible".to_string())?;
        }
        Ok(())
    }
    pub fn validate_file(path: &Path) -> Result<(), String> {
        let c = Connection::open(path).map_err(|_| "Sauvegarde illisible".to_string())?;
        let ok: String = c
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(|_| "Sauvegarde invalide".to_string())?;
        if ok != "ok" {
            return Err("L’intégrité de la sauvegarde est invalide".into());
        }
        for t in ["users", "products", "sales", "schema_migrations"] {
            let found: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [t],
                    |r| r.get(0),
                )
                .map_err(|_| "Sauvegarde invalide".to_string())?;
            if found != 1 {
                return Err("La sauvegarde ne contient pas les tables requises".into());
            }
        }
        Ok(())
    }
}

const SCHEMA: &str = r#"
CREATE TABLE app_settings(id INTEGER PRIMARY KEY CHECK(id=1),shop_name TEXT NOT NULL DEFAULT 'Maktaba',phone TEXT,address TEXT,receipt_footer TEXT,currency TEXT NOT NULL DEFAULT 'MAD',barcode_prefix TEXT NOT NULL DEFAULT 'MKT',next_barcode_sequence INTEGER NOT NULL DEFAULT 1,low_stock_default INTEGER NOT NULL DEFAULT 5,receipt_width INTEGER NOT NULL DEFAULT 80,automatic_backup INTEGER NOT NULL DEFAULT 0,backup_retention INTEGER NOT NULL DEFAULT 7,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE users(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,username TEXT NOT NULL COLLATE NOCASE UNIQUE,email TEXT COLLATE NOCASE UNIQUE,phone TEXT,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('global_admin','manager','cashier','stock_worker')),is_active INTEGER NOT NULL DEFAULT 1,must_change_password INTEGER NOT NULL DEFAULT 0,last_login_at TEXT,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT,is_active INTEGER NOT NULL DEFAULT 1,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE products(id INTEGER PRIMARY KEY,category_id INTEGER REFERENCES categories(id),name TEXT NOT NULL,description TEXT,product_type TEXT NOT NULL CHECK(product_type IN('physical_product','service')),sku TEXT UNIQUE,manufacturer_barcode TEXT UNIQUE,internal_barcode TEXT NOT NULL UNIQUE,qr_identifier TEXT NOT NULL UNIQUE,purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price_cents>=0),selling_price_cents INTEGER NOT NULL CHECK(selling_price_cents>=0),wholesale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(wholesale_price_cents>=0),wholesale_min_quantity INTEGER NOT NULL DEFAULT 1,current_stock INTEGER NOT NULL DEFAULT 0 CHECK(current_stock>=0),minimum_stock INTEGER NOT NULL DEFAULT 0,unit TEXT NOT NULL DEFAULT 'unité',shelf_location TEXT,is_active INTEGER NOT NULL DEFAULT 1,track_stock INTEGER NOT NULL DEFAULT 1,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_price_history(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),price_type TEXT NOT NULL,old_value_cents INTEGER NOT NULL,new_value_cents INTEGER NOT NULL,reason TEXT,changed_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE customers(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,phone TEXT,email TEXT,address TEXT,notes TEXT,credit_limit_cents INTEGER NOT NULL DEFAULT 0,current_debt_cents INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE customer_credit_transactions(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),sale_id INTEGER REFERENCES sales(id),transaction_type TEXT NOT NULL,amount_cents INTEGER NOT NULL,balance_after_cents INTEGER NOT NULL,notes TEXT,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,contact_name TEXT,phone TEXT,email TEXT,address TEXT,notes TEXT,current_debt_cents INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE cash_register_sessions(id INTEGER PRIMARY KEY,cashier_id INTEGER NOT NULL REFERENCES users(id),opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,opening_amount_cents INTEGER NOT NULL,closed_at TEXT,expected_closing_cents INTEGER,actual_closing_cents INTEGER,difference_cents INTEGER,difference_reason TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX one_open_register ON cash_register_sessions(cashier_id) WHERE status='open';
CREATE TABLE cash_movements(id INTEGER PRIMARY KEY,cash_register_session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id),movement_type TEXT NOT NULL,amount_cents INTEGER NOT NULL,reference_type TEXT,reference_id INTEGER,reason TEXT,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sales(id INTEGER PRIMARY KEY,sale_number TEXT NOT NULL UNIQUE,customer_id INTEGER REFERENCES customers(id),cashier_id INTEGER NOT NULL REFERENCES users(id),cash_register_session_id INTEGER REFERENCES cash_register_sessions(id),subtotal_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,cash_paid_cents INTEGER NOT NULL,credit_amount_cents INTEGER NOT NULL,change_cents INTEGER NOT NULL,payment_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'completed',notes TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER NOT NULL REFERENCES sales(id),product_id INTEGER NOT NULL REFERENCES products(id),product_name_snapshot TEXT NOT NULL,sku_snapshot TEXT,barcode_snapshot TEXT,product_type_snapshot TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price_cents INTEGER NOT NULL,purchase_price_snapshot_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,line_total_cents INTEGER NOT NULL,returned_quantity INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),movement_type TEXT NOT NULL,quantity_change INTEGER NOT NULL,stock_before INTEGER NOT NULL,stock_after INTEGER NOT NULL,reference_type TEXT,reference_id INTEGER,reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE purchases(id INTEGER PRIMARY KEY,purchase_number TEXT NOT NULL UNIQUE,supplier_id INTEGER NOT NULL REFERENCES suppliers(id),cash_register_session_id INTEGER REFERENCES cash_register_sessions(id),subtotal_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,paid_cents INTEGER NOT NULL,remaining_cents INTEGER NOT NULL,reference TEXT,notes TEXT,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE purchase_items(id INTEGER PRIMARY KEY,purchase_id INTEGER NOT NULL REFERENCES purchases(id),product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,unit_purchase_price_cents INTEGER NOT NULL,line_total_cents INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE supplier_payments(id INTEGER PRIMARY KEY,supplier_id INTEGER NOT NULL REFERENCES suppliers(id),purchase_id INTEGER REFERENCES purchases(id),cash_register_session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id),amount_cents INTEGER NOT NULL,notes TEXT,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE expenses(id INTEGER PRIMARY KEY,category TEXT NOT NULL,description TEXT NOT NULL,amount_cents INTEGER NOT NULL,cash_register_session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id),expense_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',correction_of_id INTEGER REFERENCES expenses(id),notes TEXT,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE returns(id INTEGER PRIMARY KEY,return_number TEXT NOT NULL UNIQUE,original_sale_id INTEGER NOT NULL REFERENCES sales(id),customer_id INTEGER REFERENCES customers(id),cash_register_session_id INTEGER REFERENCES cash_register_sessions(id),total_return_value_cents INTEGER NOT NULL,customer_debt_reduction_cents INTEGER NOT NULL,cash_refund_cents INTEGER NOT NULL,reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER NOT NULL REFERENCES returns(id),sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,amount_cents INTEGER NOT NULL,condition TEXT,restock INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id INTEGER,old_values_json TEXT,new_values_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_product_name ON products(name); CREATE INDEX idx_product_sku ON products(sku); CREATE INDEX idx_product_mbar ON products(manufacturer_barcode); CREATE INDEX idx_product_ibar ON products(internal_barcode); CREATE INDEX idx_product_qr ON products(qr_identifier); CREATE INDEX idx_product_category ON products(category_id); CREATE INDEX idx_customer_name ON customers(full_name); CREATE INDEX idx_customer_phone ON customers(phone); CREATE INDEX idx_supplier_name ON suppliers(name); CREATE INDEX idx_sales_date ON sales(created_at); CREATE INDEX idx_sale_number ON sales(sale_number); CREATE INDEX idx_stock_date ON stock_movements(created_at); CREATE INDEX idx_register_status ON cash_register_sessions(status); CREATE INDEX idx_credit_date ON customer_credit_transactions(created_at); CREATE INDEX idx_audit_date ON audit_logs(created_at);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrations_create_tables() {
        let p = std::env::temp_dir().join(format!("maktaba-{}.db", uuid::Uuid::new_v4()));
        let db = Database::temporary(p.clone()).unwrap();
        let c = db.connect().unwrap();
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sales'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
        drop(c);
        std::fs::remove_file(p).ok();
    }
}
