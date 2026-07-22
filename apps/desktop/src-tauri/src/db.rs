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
        let path = dir.join("maktaba-pos.sqlite3");
        migrate_legacy_database(&dir, &path)?;
        let db = Self {
            path,
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
        let v2: Option<i64> = c
            .query_row(
                "SELECT version FROM schema_migrations WHERE version=2",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Migration impossible".to_string())?;
        if v2.is_none() {
            let tx = c
                .unchecked_transaction()
                .map_err(|_| "Migration impossible".to_string())?;
            tx.execute_batch("CREATE TABLE cash_register_denominations(id INTEGER PRIMARY KEY,cash_register_session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id),denomination_cents INTEGER NOT NULL CHECK(denomination_cents>0),quantity INTEGER NOT NULL CHECK(quantity>=0),total_cents INTEGER NOT NULL CHECK(total_cents>=0),UNIQUE(cash_register_session_id,denomination_cents)); CREATE INDEX idx_expense_date ON expenses(expense_date); CREATE INDEX idx_returns_sale ON returns(original_sale_id);").map_err(|_|"Migration 2 impossible".to_string())?;
            tx.execute("INSERT INTO schema_migrations(version,name)VALUES(2,'denominations_and_financial_indexes')",[]).map_err(|_|"Migration impossible".to_string())?;
            tx.commit()
                .map_err(|_| "Migration impossible".to_string())?;
        }
        let v3: Option<i64> = c
            .query_row(
                "SELECT version FROM schema_migrations WHERE version=3",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Migration impossible".to_string())?;
        if v3.is_none() {
            let tx = c
                .unchecked_transaction()
                .map_err(|_| "Migration impossible".to_string())?;
            tx.execute_batch(
                "CREATE TABLE offline_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE offline_categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE offline_products(id INTEGER PRIMARY KEY,category_id INTEGER,name TEXT NOT NULL,description TEXT,product_type TEXT NOT NULL,sku TEXT,manufacturer_barcode TEXT,internal_barcode TEXT NOT NULL UNIQUE,qr_identifier TEXT NOT NULL UNIQUE,purchase_price_cents INTEGER NOT NULL DEFAULT 0,selling_price_cents INTEGER NOT NULL DEFAULT 0,wholesale_price_cents INTEGER NOT NULL DEFAULT 0,wholesale_min_quantity INTEGER NOT NULL DEFAULT 1,current_stock INTEGER NOT NULL DEFAULT 0,minimum_stock INTEGER NOT NULL DEFAULT 0,unit TEXT NOT NULL DEFAULT 'unité',shelf_location TEXT,is_active INTEGER NOT NULL DEFAULT 1,track_stock INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE offline_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE offline_outbox(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL CHECK(status IN ('pending','syncing','synced','rejected')) DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,last_status_code INTEGER); CREATE INDEX idx_offline_outbox_status ON offline_outbox(status);",
            )
            .map_err(|_| "Migration 3 impossible".to_string())?;
            tx.execute(
                "INSERT INTO schema_migrations(version,name) VALUES(3,'offline_outbox_schema')",
                [],
            )
            .map_err(|_| "Migration impossible".to_string())?;
            tx.commit()
                .map_err(|_| "Migration impossible".to_string())?;
        }
        let v4: Option<i64> = c
            .query_row(
                "SELECT version FROM schema_migrations WHERE version=4",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Migration impossible".to_string())?;
        if v4.is_none() {
            let tx = c
                .unchecked_transaction()
                .map_err(|_| "Migration impossible".to_string())?;
            tx.execute_batch(
                r#"
ALTER TABLE offline_metadata RENAME TO offline_metadata_v3;
ALTER TABLE offline_categories RENAME TO offline_categories_v3;
ALTER TABLE offline_products RENAME TO offline_products_v3;
ALTER TABLE offline_settings RENAME TO offline_settings_v3;
ALTER TABLE offline_outbox RENAME TO offline_outbox_v3;

CREATE TABLE offline_metadata(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE offline_categories(
  server_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE offline_products(
  server_id INTEGER PRIMARY KEY,
  barcode TEXT,
  internal_barcode TEXT,
  sku TEXT,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL,
  sale_price_cents INTEGER NOT NULL CHECK(sale_price_cents >= 0),
  stock_quantity REAL NOT NULL,
  is_active INTEGER NOT NULL CHECK(is_active IN (0,1)),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE offline_settings(
  id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE offline_outbox(
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK(operation_type = 'cash_sale'),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','syncing','synced','rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error TEXT,
  last_status_code INTEGER,
  server_entity_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT
);
CREATE INDEX idx_offline_products_barcode ON offline_products(barcode);
CREATE INDEX idx_offline_products_internal_barcode ON offline_products(internal_barcode);
CREATE INDEX idx_offline_products_sku ON offline_products(sku);
CREATE INDEX idx_offline_products_name ON offline_products(name);
CREATE INDEX idx_offline_outbox_status_created ON offline_outbox(status,created_at);

INSERT INTO offline_outbox(
  id,operation_type,idempotency_key,payload_json,status,attempt_count,last_error,
  last_status_code,created_at,updated_at,synced_at
)
SELECT id,'cash_sale',
       coalesce(json_extract(payload_json,'$.idempotencyKey'),id),
       payload_json,status,attempts,last_error,last_status_code,created_at,
       created_at,CASE WHEN status='synced' THEN created_at END
FROM offline_outbox_v3;
"#,
            )
            .map_err(|_| "Migration hors ligne v4 impossible".to_string())?;
            tx.execute(
                "INSERT INTO schema_migrations(version,name) VALUES(4,'safe_offline_cache_outbox')",
                [],
            )
            .map_err(|_| "Migration impossible".to_string())?;
            tx.commit()
                .map_err(|_| "Migration impossible".to_string())?;
        }
        let v5: Option<i64> = c
            .query_row(
                "SELECT version FROM schema_migrations WHERE version=5",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Migration impossible".to_string())?;
        if v5.is_none() {
            let tx = c
                .unchecked_transaction()
                .map_err(|_| "Migration impossible".to_string())?;
            tx.execute_batch(
                r#"
CREATE TABLE offline_serialized_units(
  server_id INTEGER PRIMARY KEY,
  barcode TEXT NOT NULL COLLATE NOCASE UNIQUE,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  sale_price_cents INTEGER NOT NULL CHECK(sale_price_cents>=0),
  product_active INTEGER NOT NULL CHECK(product_active IN (0,1)),
  server_status TEXT NOT NULL CHECK(server_status IN ('available','sold','damaged','lost','inactive')),
  reservation_id TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_offline_serialized_product ON offline_serialized_units(product_id);
CREATE INDEX idx_offline_serialized_status ON offline_serialized_units(server_status,reservation_id);
INSERT INTO schema_migrations(version,name) VALUES(5,'serialized_unit_cache');
"#,
            )
            .map_err(|_| "Migration hors ligne v5 impossible".to_string())?;
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

fn migrate_legacy_database(new_dir: &Path, new_path: &Path) -> Result<(), String> {
    let marker = new_dir.join("double-library-migration-v1.complete");
    if marker.exists() {
        return Ok(());
    }
    let Some(parent) = new_dir.parent() else {
        return Ok(());
    };
    let legacy = ["com.pc.maktaba-pos", "com.maktaba.pos"]
        .iter()
        .map(|identifier| parent.join(identifier).join("maktaba-pos.sqlite3"))
        .find(|path| path.is_file());
    let Some(legacy) = legacy else {
        return Ok(());
    };
    if new_path.exists() {
        eprintln!(
            "[desktop-migration] anciennes et nouvelles données présentes; aucune donnée écrasée"
        );
        return Ok(());
    }
    let source = Connection::open(&legacy)
        .map_err(|_| "Anciennes données locales illisibles".to_string())?;
    let mut destination = Connection::open(new_path)
        .map_err(|_| "Migration des données locales impossible".to_string())?;
    let backup = rusqlite::backup::Backup::new(&source, &mut destination)
        .map_err(|_| "Migration des données locales impossible".to_string())?;
    backup
        .run_to_completion(5, std::time::Duration::from_millis(50), None)
        .map_err(|_| "Migration des données locales impossible".to_string())?;
    drop(backup);
    drop(destination);
    drop(source);
    Database::validate_file(new_path)?;
    fs::write(marker, "legacy database copied and verified\n")
        .map_err(|_| "Marquage de la migration impossible".to_string())?;
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE app_settings(id INTEGER PRIMARY KEY CHECK(id=1),shop_name TEXT NOT NULL DEFAULT 'Double Library',phone TEXT,address TEXT,receipt_footer TEXT,currency TEXT NOT NULL DEFAULT 'MAD',barcode_prefix TEXT NOT NULL DEFAULT 'MKT',next_barcode_sequence INTEGER NOT NULL DEFAULT 1,low_stock_default INTEGER NOT NULL DEFAULT 5,receipt_width INTEGER NOT NULL DEFAULT 80,automatic_backup INTEGER NOT NULL DEFAULT 0,backup_retention INTEGER NOT NULL DEFAULT 7,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
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
    fn temporary() -> (Database, PathBuf) {
        let path = std::env::temp_dir().join(format!("maktaba-{}.db", uuid::Uuid::new_v4()));
        (Database::temporary(path.clone()).unwrap(), path)
    }
    #[test]
    fn migrations_create_tables() {
        let (db, p) = temporary();
        let c = db.connect().unwrap();
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='sales'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
        let serialized: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='offline_serialized_units'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(serialized, 1);
        drop(c);
        std::fs::remove_file(p).ok();
    }
    #[test]
    fn legacy_identity_database_is_copied_once_without_overwrite() {
        let root =
            std::env::temp_dir().join(format!("double-library-migration-{}", uuid::Uuid::new_v4()));
        let legacy_dir = root.join("com.pc.maktaba-pos");
        let new_dir = root.join("com.pc.doublelibrary");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::create_dir_all(&new_dir).unwrap();
        let legacy_path = legacy_dir.join("maktaba-pos.sqlite3");
        let legacy_db = Database::temporary(legacy_path).unwrap();
        legacy_db.connect().unwrap().execute("INSERT INTO offline_metadata(key,value_json,updated_at) VALUES('device_id','{\"id\":\"device-1\"}','2026-07-22')", []).unwrap();
        drop(legacy_db);
        let new_path = new_dir.join("maktaba-pos.sqlite3");
        migrate_legacy_database(&new_dir, &new_path).unwrap();
        let migrated = Connection::open(&new_path).unwrap();
        let value: String = migrated
            .query_row(
                "SELECT value_json FROM offline_metadata WHERE key='device_id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(value.contains("device-1"));
        drop(migrated);
        let original_size = std::fs::metadata(&new_path).unwrap().len();
        migrate_legacy_database(&new_dir, &new_path).unwrap();
        assert_eq!(std::fs::metadata(&new_path).unwrap().len(), original_size);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn offline_outbox_enforces_unique_key_and_valid_status() {
        let (db, p) = temporary();
        let c = db.connect().unwrap();
        let insert = |id: &str, key: &str, status: &str| {
            c.execute("INSERT INTO offline_outbox(id,operation_type,idempotency_key,payload_json,status,created_at,updated_at) VALUES(?1,'cash_sale',?2,'{}',?3,'2026-01-01','2026-01-01')", rusqlite::params![id,key,status])
        };
        assert_eq!(insert("one", "key", "pending").unwrap(), 1);
        assert!(insert("two", "key", "pending").is_err());
        assert!(insert("three", "key-three", "unknown").is_err());
        drop(c);
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn offline_outbox_pending_order_is_deterministic() {
        let (db, p) = temporary();
        let c = db.connect().unwrap();
        for (id, key, created) in [("later", "b", "2026-01-02"), ("first", "a", "2026-01-01")] {
            c.execute("INSERT INTO offline_outbox(id,operation_type,idempotency_key,payload_json,status,created_at,updated_at) VALUES(?1,'cash_sale',?2,'{}','pending',?3,?3)", rusqlite::params![id,key,created]).unwrap();
        }
        let first: String = c.query_row("SELECT id FROM offline_outbox WHERE status='pending' ORDER BY created_at,id LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(first, "first");
        drop(c);
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn offline_cache_upsert_and_barcode_query_survive_reopen() {
        let (db, p) = temporary();
        {
            let c = db.connect().unwrap();
            c.execute("INSERT INTO offline_products(server_id,barcode,internal_barcode,sku,name,product_type,sale_price_cents,stock_quantity,is_active,payload_json,updated_at) VALUES(9,'6111','INT9','SKU9','Cahier','physical_product',1200,4,1,'{\"id\":9}','2026-01-01')", []).unwrap();
        }
        let reopened = Database::temporary(p.clone()).unwrap();
        let c = reopened.connect().unwrap();
        let id: i64 = c
            .query_row(
                "SELECT server_id FROM offline_products WHERE barcode=?1",
                ["6111"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(id, 9);
        drop(c);
        std::fs::remove_file(p).ok();
    }

    #[test]
    fn serialized_cache_reservation_survives_reopen_and_is_unique() {
        let (db, p) = temporary();
        {
            let c = db.connect().unwrap();
            c.execute("INSERT INTO offline_serialized_units(server_id,barcode,product_id,product_name,sale_price_cents,product_active,server_status,payload_json,updated_at) VALUES(1,'SER-1',9,'Calculatrice',1200,1,'available','{}','2026-01-01')", []).unwrap();
            assert_eq!(c.execute("UPDATE offline_serialized_units SET reservation_id='cart-1' WHERE barcode='SER-1' AND reservation_id IS NULL AND server_status='available'", []).unwrap(), 1);
            assert_eq!(c.execute("UPDATE offline_serialized_units SET reservation_id='cart-2' WHERE barcode='SER-1' AND reservation_id IS NULL AND server_status='available'", []).unwrap(), 0);
        }
        let reopened = Database::temporary(p.clone()).unwrap();
        let c = reopened.connect().unwrap();
        let reservation: String = c
            .query_row(
                "SELECT reservation_id FROM offline_serialized_units WHERE barcode='SER-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(reservation, "cart-1");
        drop(c);
        std::fs::remove_file(p).ok();
    }
}
