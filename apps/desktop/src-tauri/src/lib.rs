mod db;
mod operations;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use db::Database;
use rand_core::OsRng;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SafeUser {
    id: i64,
    full_name: String,
    username: String,
    role: String,
    must_change_password: bool,
    permissions: Vec<String>,
}
#[derive(Default)]
struct Session(Mutex<Option<SafeUser>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    needs_onboarding: bool,
    user: Option<SafeUser>,
    database_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerInput {
    shop_name: String,
    full_name: String,
    username: String,
    email: Option<String>,
    password: String,
    barcode_prefix: String,
}
#[derive(Deserialize)]
struct LoginInput {
    login: String,
    password: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductInput {
    id: Option<i64>,
    category_id: Option<i64>,
    name: String,
    description: Option<String>,
    product_type: String,
    sku: Option<String>,
    manufacturer_barcode: Option<String>,
    purchase_price_cents: i64,
    selling_price_cents: i64,
    wholesale_price_cents: i64,
    wholesale_min_quantity: i64,
    minimum_stock: i64,
    unit: String,
    shelf_location: Option<String>,
    track_stock: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleInput {
    customer_id: Option<i64>,
    items: Vec<SaleLine>,
    discount_cents: i64,
    cash_paid_cents: i64,
    credit_amount_cents: i64,
    notes: Option<String>,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleLine {
    product_id: i64,
    quantity: i64,
    unit_price_cents: i64,
    discount_cents: i64,
}

fn role_permissions(role: &str) -> Vec<String> {
    let all = [
        "dashboard.view",
        "dashboard.financials",
        "pos.use",
        "sales.view",
        "sales.create",
        "sales.return",
        "products.view",
        "products.create",
        "products.edit",
        "products.deactivate",
        "categories.manage",
        "stock.view",
        "stock.adjust",
        "stock.inventory",
        "customers.view",
        "customers.create",
        "customers.edit",
        "customers.credit.view",
        "customers.credit.payment",
        "suppliers.view",
        "suppliers.manage",
        "suppliers.payment",
        "purchases.view",
        "purchases.create",
        "expenses.view",
        "expenses.create",
        "expenses.correct",
        "register.open",
        "register.close",
        "register.view_all",
        "workers.view",
        "workers.create",
        "workers.edit",
        "reports.sales",
        "reports.profit",
        "reports.cash",
        "reports.workers",
        "backup.manage",
        "settings.manage",
        "audit.view",
    ];
    let selected: Vec<&str> = match role {
        "global_admin" => all.to_vec(),
        "manager" => all
            .iter()
            .copied()
            .filter(|p| !matches!(*p, "backup.manage" | "settings.manage" | "audit.view"))
            .collect(),
        "cashier" => vec![
            "dashboard.view",
            "pos.use",
            "sales.view",
            "sales.create",
            "sales.return",
            "customers.view",
            "customers.create",
            "customers.credit.view",
            "customers.credit.payment",
            "register.open",
            "register.close",
        ],
        _ => vec![
            "dashboard.view",
            "products.view",
            "products.create",
            "products.edit",
            "categories.manage",
            "stock.view",
            "stock.adjust",
            "stock.inventory",
            "suppliers.view",
            "suppliers.manage",
            "purchases.view",
            "purchases.create",
        ],
    };
    selected.into_iter().map(String::from).collect()
}
fn current(session: &State<Session>, permission: &str) -> Result<SafeUser, String> {
    let u = session
        .0
        .lock()
        .map_err(|_| "Session indisponible".to_string())?
        .clone()
        .ok_or("Veuillez vous connecter".to_string())?;
    if !u.permissions.iter().any(|p| p == permission) {
        return Err("Vous n’avez pas l’autorisation requise".into());
    }
    Ok(u)
}
fn strong(p: &str) -> bool {
    p.len() >= 8
        && p.chars().any(char::is_uppercase)
        && p.chars().any(char::is_lowercase)
        && p.chars().any(|c| c.is_ascii_digit())
}
fn hash_password(p: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(p.as_bytes(), &salt)
        .map(|x| x.to_string())
        .map_err(|_| "Impossible de sécuriser le mot de passe".into())
}
fn verify_password(p: &str, h: &str) -> bool {
    PasswordHash::new(h)
        .ok()
        .is_some_and(|h| Argon2::default().verify_password(p.as_bytes(), &h).is_ok())
}
fn db_err(_: rusqlite::Error) -> String {
    "L’opération sur la base de données a échoué".into()
}
fn text(v: Option<String>) -> Option<String> {
    v.and_then(|s| {
        let t = s.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

#[tauri::command]
fn bootstrap(db: State<Database>, session: State<Session>) -> Result<Bootstrap, String> {
    let c = db.connect()?;
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM users WHERE role='global_admin' AND is_active=1",
            [],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    Ok(Bootstrap {
        needs_onboarding: n == 0,
        user: session
            .0
            .lock()
            .map_err(|_| "Session indisponible")?
            .clone(),
        database_path: db.path.display().to_string(),
    })
}
#[tauri::command]
fn create_owner(
    input: OwnerInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<SafeUser, String> {
    if input.shop_name.trim().is_empty()
        || input.full_name.trim().is_empty()
        || input.username.trim().len() < 3
    {
        return Err("Veuillez remplir tous les champs obligatoires".into());
    }
    if !strong(&input.password) {
        return Err("Le mot de passe doit contenir 8 caractères, une majuscule, une minuscule et un chiffre".into());
    }
    let prefix = input.barcode_prefix.trim().to_uppercase();
    if prefix.len() < 2 || !prefix.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Préfixe de code-barres invalide".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let n: i64 = tx
        .query_row(
            "SELECT count(*) FROM users WHERE role='global_admin'",
            [],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    if n > 0 {
        return Err("Le propriétaire a déjà été créé".into());
    }
    let hash = hash_password(&input.password)?;
    tx.execute("INSERT INTO users(full_name,username,email,password_hash,role) VALUES(?1,?2,?3,?4,'global_admin')",params![input.full_name.trim(),input.username.trim(),text(input.email),hash]).map_err(|_|"Ce nom d’utilisateur ou cet e-mail existe déjà".to_string())?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO app_settings(id,shop_name,barcode_prefix) VALUES(1,?1,?2)",
        params![input.shop_name.trim(), prefix],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values_json) VALUES(?1,'owner.created','user',?1,?2)",params![id,json!({"username":input.username}).to_string()]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    let u = SafeUser {
        id,
        full_name: input.full_name.trim().into(),
        username: input.username.trim().into(),
        role: "global_admin".into(),
        must_change_password: false,
        permissions: role_permissions("global_admin"),
    };
    *session.0.lock().map_err(|_| "Session indisponible")? = Some(u.clone());
    Ok(u)
}
#[tauri::command]
fn login(
    input: LoginInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<SafeUser, String> {
    let c = db.connect()?;
    let row:Option<(i64,String,String,String,String,bool,bool)>=c.query_row("SELECT id,full_name,username,password_hash,role,is_active,must_change_password FROM users WHERE username=?1 COLLATE NOCASE OR email=?1 COLLATE NOCASE",[input.login.trim()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(db_err)?;
    let Some((id, full_name, username, hash, role, active, must)) = row else {
        return Err("Identifiants incorrects".into());
    };
    if !active {
        return Err("Ce compte est désactivé".into());
    }
    if !verify_password(&input.password, &hash) {
        return Err("Identifiants incorrects".into());
    }
    c.execute(
        "UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?1",
        [id],
    )
    .map_err(db_err)?;
    let u = SafeUser {
        id,
        full_name,
        username,
        role: role.clone(),
        must_change_password: must,
        permissions: role_permissions(&role),
    };
    *session.0.lock().map_err(|_| "Session indisponible")? = Some(u.clone());
    Ok(u)
}
#[tauri::command]
fn logout(session: State<Session>) -> Result<(), String> {
    *session.0.lock().map_err(|_| "Session indisponible")? = None;
    Ok(())
}

#[tauri::command]
fn dashboard(db: State<Database>, session: State<Session>) -> Result<Value, String> {
    current(&session, "dashboard.view")?;
    let c = db.connect()?;
    let one = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    Ok(
        json!({"salesToday":one("SELECT coalesce(sum(total_cents),0) FROM sales WHERE date(created_at)=date('now','localtime') AND status!='cancelled'"),"cashToday":one("SELECT coalesce(sum(cash_paid_cents),0) FROM sales WHERE date(created_at)=date('now','localtime')"),"customerDebt":one("SELECT coalesce(sum(current_debt_cents),0) FROM customers"),"supplierDebt":one("SELECT coalesce(sum(current_debt_cents),0) FROM suppliers"),"expensesToday":one("SELECT coalesce(sum(amount_cents),0) FROM expenses WHERE date(expense_date)=date('now','localtime') AND status='active'"),"saleCount":one("SELECT count(*) FROM sales WHERE date(created_at)=date('now','localtime')"),"lowStock":one("SELECT count(*) FROM products WHERE track_stock=1 AND is_active=1 AND current_stock<=minimum_stock"),"stockValue":one("SELECT coalesce(sum(current_stock*purchase_price_cents),0) FROM products WHERE track_stock=1"),"openRegister":one("SELECT count(*) FROM cash_register_sessions WHERE status='open'")>0}),
    )
}

#[tauri::command]
fn list_categories(db: State<Database>, session: State<Session>) -> Result<Value, String> {
    current(&session, "products.view").or_else(|_| current(&session, "categories.manage"))?;
    let c = db.connect()?;
    let mut q=c.prepare("SELECT id,name,coalesce(description,''),is_active,(SELECT count(*) FROM products p WHERE p.category_id=categories.id AND p.is_active=1) FROM categories ORDER BY name").map_err(db_err)?;
    let rows=q.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"description":r.get::<_,String>(2)?,"isActive":r.get::<_,bool>(3)?,"productCount":r.get::<_,i64>(4)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!(rows))
}
#[tauri::command]
fn save_category(
    id: Option<i64>,
    name: String,
    description: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "categories.manage")?;
    if name.trim().is_empty() {
        return Err("Le nom est obligatoire".into());
    }
    let c = db.connect()?;
    if let Some(id) = id {
        c.execute(
            "UPDATE categories SET name=?1,description=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?3",
            params![name.trim(), text(description), id],
        )
        .map_err(|_| "Cette catégorie existe déjà".to_string())?;
        Ok(id)
    } else {
        c.execute(
            "INSERT INTO categories(name,description,created_by) VALUES(?1,?2,?3)",
            params![name.trim(), text(description), u.id],
        )
        .map_err(|_| "Cette catégorie existe déjà".to_string())?;
        Ok(c.last_insert_rowid())
    }
}
#[tauri::command]
fn toggle_category(
    id: i64,
    active: bool,
    db: State<Database>,
    session: State<Session>,
) -> Result<(), String> {
    current(&session, "categories.manage")?;
    let c = db.connect()?;
    if !active {
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM products WHERE category_id=?1 AND is_active=1",
                [id],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if n > 0 {
            return Err(format!("Cette catégorie contient {n} produit(s) actif(s)"));
        }
    }
    c.execute(
        "UPDATE categories SET is_active=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
        params![active, id],
    )
    .map_err(db_err)?;
    Ok(())
}

#[tauri::command]
fn list_products(
    search: Option<String>,
    category_id: Option<i64>,
    low_stock: Option<bool>,
    page: Option<i64>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "products.view")?;
    let c = db.connect()?;
    let p = page.unwrap_or(1).max(1);
    let term = format!("%{}%", search.unwrap_or_default());
    let mut q=c.prepare("SELECT p.id,p.name,p.product_type,coalesce(p.sku,''),coalesce(p.manufacturer_barcode,''),p.internal_barcode,p.qr_identifier,p.selling_price_cents,p.purchase_price_cents,p.current_stock,p.minimum_stock,p.is_active,p.track_stock,coalesce(c.name,'Sans catégorie') FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE (?1='%%' OR p.name LIKE ?1 OR p.sku LIKE ?1 OR p.manufacturer_barcode LIKE ?1 OR p.internal_barcode LIKE ?1 OR p.qr_identifier LIKE ?1) AND (?2 IS NULL OR p.category_id=?2) AND (?3=0 OR (p.track_stock=1 AND p.current_stock<=p.minimum_stock)) ORDER BY p.name LIMIT 30 OFFSET ?4").map_err(db_err)?;
    let rows=q.query_map(params![term,category_id,low_stock.unwrap_or(false), (p-1)*30],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"productType":r.get::<_,String>(2)?,"sku":r.get::<_,String>(3)?,"manufacturerBarcode":r.get::<_,String>(4)?,"internalBarcode":r.get::<_,String>(5)?,"qrIdentifier":r.get::<_,String>(6)?,"sellingPriceCents":r.get::<_,i64>(7)?,"purchasePriceCents":r.get::<_,i64>(8)?,"currentStock":r.get::<_,i64>(9)?,"minimumStock":r.get::<_,i64>(10)?,"isActive":r.get::<_,bool>(11)?,"trackStock":r.get::<_,bool>(12)?,"categoryName":r.get::<_,String>(13)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!(rows))
}
#[tauri::command]
fn save_product(
    input: ProductInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(
        &session,
        if input.id.is_some() {
            "products.edit"
        } else {
            "products.create"
        },
    )?;
    if input.name.trim().is_empty()
        || input.selling_price_cents < 0
        || input.purchase_price_cents < 0
    {
        return Err("Données produit invalides".into());
    }
    if !matches!(input.product_type.as_str(), "physical_product" | "service") {
        return Err("Type de produit invalide".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    if let Some(id) = input.id {
        let old:(i64,i64,i64)=tx.query_row("SELECT purchase_price_cents,selling_price_cents,wholesale_price_cents FROM products WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_err)?;
        tx.execute("UPDATE products SET category_id=?1,name=?2,description=?3,product_type=?4,sku=?5,manufacturer_barcode=?6,purchase_price_cents=?7,selling_price_cents=?8,wholesale_price_cents=?9,wholesale_min_quantity=?10,minimum_stock=?11,unit=?12,shelf_location=?13,track_stock=?14,updated_at=CURRENT_TIMESTAMP WHERE id=?15",params![input.category_id,input.name.trim(),text(input.description),input.product_type,text(input.sku),text(input.manufacturer_barcode),input.purchase_price_cents,input.selling_price_cents,input.wholesale_price_cents,input.wholesale_min_quantity,input.minimum_stock,input.unit,input.shelf_location,input.track_stock,id]).map_err(|_|"SKU ou code-barres déjà utilisé".to_string())?;
        for (kind, a, b) in [
            ("purchase_price", old.0, input.purchase_price_cents),
            ("selling_price", old.1, input.selling_price_cents),
            ("wholesale_price", old.2, input.wholesale_price_cents),
        ] {
            if a != b {
                tx.execute("INSERT INTO product_price_history(product_id,price_type,old_value_cents,new_value_cents,reason,changed_by) VALUES(?1,?2,?3,?4,'Modification produit',?5)",params![id,kind,a,b,u.id]).map_err(db_err)?;
            }
        }
        tx.commit().map_err(db_err)?;
        Ok(id)
    } else {
        let (prefix, seq): (String, i64) = tx
            .query_row(
                "SELECT barcode_prefix,next_barcode_sequence FROM app_settings WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(db_err)?;
        let code = format!("{}-{:06}", prefix, seq);
        let qr = format!("{}-P-{}", prefix, code);
        tx.execute("INSERT INTO products(category_id,name,description,product_type,sku,manufacturer_barcode,internal_barcode,qr_identifier,purchase_price_cents,selling_price_cents,wholesale_price_cents,wholesale_min_quantity,minimum_stock,unit,shelf_location,track_stock,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",params![input.category_id,input.name.trim(),text(input.description),input.product_type,text(input.sku),text(input.manufacturer_barcode),code,qr,input.purchase_price_cents,input.selling_price_cents,input.wholesale_price_cents,input.wholesale_min_quantity,input.minimum_stock,input.unit,input.shelf_location,input.track_stock,u.id]).map_err(|_|"SKU ou code-barres déjà utilisé".to_string())?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE app_settings SET next_barcode_sequence=next_barcode_sequence+1 WHERE id=1",
            [],
        )
        .map_err(db_err)?;
        tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?1,'product.created','product',?2)",params![u.id,id]).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(id)
    }
}
#[tauri::command]
fn adjust_stock(
    product_id: i64,
    quantity: i64,
    movement_type: String,
    reason: String,
    db: State<Database>,
    session: State<Session>,
) -> Result<(), String> {
    let u = current(&session, "stock.adjust")?;
    if quantity == 0 || reason.trim().is_empty() {
        return Err("Quantité et motif obligatoires".into());
    }
    let allowed = [
        "stock_in",
        "stock_out",
        "damaged",
        "lost",
        "inventory_correction",
        "manual_correction",
    ];
    if !allowed.contains(&movement_type.as_str()) {
        return Err("Type d’ajustement invalide".into());
    }
    let delta = if matches!(movement_type.as_str(), "stock_out" | "damaged" | "lost") {
        -quantity.abs()
    } else {
        quantity
    };
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let before: i64 = tx
        .query_row(
            "SELECT current_stock FROM products WHERE id=?1 AND track_stock=1",
            [product_id],
            |r| r.get(0),
        )
        .map_err(|_| "Produit physique introuvable".to_string())?;
    let after = before + delta;
    if after < 0 {
        return Err("Le stock ne peut pas devenir négatif".into());
    }
    tx.execute(
        "UPDATE products SET current_stock=?1 WHERE id=?2",
        params![after, product_id],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reason,created_by) VALUES(?1,'manual_adjustment',?2,?3,?4,?5,?6)",params![product_id,delta,before,after,format!("{}: {}",movement_type,reason.trim()),u.id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(())
}

#[tauri::command]
fn current_register(db: State<Database>, session: State<Session>) -> Result<Value, String> {
    let u = current(&session, "dashboard.view")?;
    let c = db.connect()?;
    let v:Option<Value>=c.query_row("SELECT id,opening_amount_cents,opened_at FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",[u.id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"openingAmountCents":r.get::<_,i64>(1)?,"openedAt":r.get::<_,String>(2)?}))).optional().map_err(db_err)?;
    Ok(v.unwrap_or(Value::Null))
}
#[tauri::command]
fn open_register(
    opening_amount_cents: i64,
    note: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "register.open")?;
    if opening_amount_cents < 0 {
        return Err("Montant invalide".into());
    }
    let c = db.connect()?;
    c.execute(
        "INSERT INTO cash_register_sessions(cashier_id,opening_amount_cents) VALUES(?1,?2)",
        params![u.id, opening_amount_cents],
    )
    .map_err(|_| "Vous avez déjà une caisse ouverte".to_string())?;
    let id = c.last_insert_rowid();
    c.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reason,created_by) VALUES(?1,'opening',?2,?3,?4)",params![id,opening_amount_cents,text(note),u.id]).map_err(db_err)?;
    Ok(id)
}
#[tauri::command]
fn close_register(
    actual_amount_cents: i64,
    difference_reason: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    let u = current(&session, "register.close")?;
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let (id,opening):(i64,i64)=tx.query_row("SELECT id,opening_amount_cents FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",[u.id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"Aucune caisse ouverte".to_string())?;
    let movements:i64=tx.query_row("SELECT coalesce(sum(CASE WHEN movement_type IN('sale','customer_payment','cash_in') THEN amount_cents WHEN movement_type IN('purchase_payment','supplier_payment','expense','refund','cash_out') THEN -amount_cents ELSE 0 END),0) FROM cash_movements WHERE cash_register_session_id=?1",[id],|r|r.get(0)).map_err(db_err)?;
    let expected = opening + movements;
    let diff = actual_amount_cents - expected;
    if diff != 0 && text(difference_reason.clone()).is_none() {
        return Err("Un motif est obligatoire en cas d’écart".into());
    }
    tx.execute("UPDATE cash_register_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP,expected_closing_cents=?1,actual_closing_cents=?2,difference_cents=?3,difference_reason=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?5",params![expected,actual_amount_cents,diff,text(difference_reason),id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(
        json!({"id":id,"expectedCents":expected,"actualCents":actual_amount_cents,"differenceCents":diff}),
    )
}

#[tauri::command]
fn create_sale(
    input: SaleInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    let u = current(&session, "sales.create")?;
    if input.items.is_empty() || input.idempotency_key.is_empty() {
        return Err("Le panier est vide".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    if let Some(existing) = tx
        .query_row(
            "SELECT id,sale_number FROM sales WHERE idempotency_key=?1",
            [&input.idempotency_key],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(db_err)?
    {
        return Ok(json!({"id":existing.0,"saleNumber":existing.1,"duplicate":true}));
    }
    let total_lines: i64 = input
        .items
        .iter()
        .map(|i| i.unit_price_cents * i.quantity - i.discount_cents)
        .sum();
    let total = total_lines - input.discount_cents;
    if total < 0 || input.cash_paid_cents + input.credit_amount_cents != total {
        return Err("La répartition du paiement ne correspond pas au total".into());
    }
    if input.credit_amount_cents > 0 && input.customer_id.is_none() {
        return Err("Un client est obligatoire pour une vente à crédit".into());
    }
    let reg: Option<i64> = tx
        .query_row(
            "SELECT id FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",
            [u.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_err)?;
    if input.cash_paid_cents > 0 && reg.is_none() {
        return Err("Ouvrez la caisse avant une vente comptant".into());
    }
    let sale_no = format!(
        "V-{}-{:06}",
        chrono::Local::now().format("%Y%m%d"),
        tx.query_row(
            "SELECT count(*)+1 FROM sales WHERE date(created_at)=date('now','localtime')",
            [],
            |r| r.get::<_, i64>(0)
        )
        .map_err(db_err)?
    );
    let payment = if input.credit_amount_cents == 0 {
        "cash"
    } else if input.cash_paid_cents == 0 {
        "credit"
    } else {
        "partial_cash_credit"
    };
    tx.execute("INSERT INTO sales(sale_number,customer_id,cashier_id,cash_register_session_id,subtotal_cents,discount_cents,total_cents,cash_paid_cents,credit_amount_cents,change_cents,payment_type,notes,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12)",params![sale_no,input.customer_id,u.id,reg,total_lines,input.discount_cents,total,input.cash_paid_cents,input.credit_amount_cents,payment,text(input.notes),input.idempotency_key]).map_err(db_err)?;
    let sale_id = tx.last_insert_rowid();
    for line in input.items {
        if line.quantity <= 0 || line.unit_price_cents < 0 {
            return Err("Ligne de vente invalide".into());
        }
        let p:(String,Option<String>,String,String,i64,i64,bool)=tx.query_row("SELECT name,sku,internal_barcode,product_type,purchase_price_cents,current_stock,is_active FROM products WHERE id=?1",[line.product_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).map_err(|_|"Produit introuvable".to_string())?;
        if !p.6 {
            return Err(format!("{} est désactivé", p.0));
        }
        let line_total = line.unit_price_cents * line.quantity - line.discount_cents;
        tx.execute("INSERT INTO sale_items(sale_id,product_id,product_name_snapshot,sku_snapshot,barcode_snapshot,product_type_snapshot,quantity,unit_price_cents,purchase_price_snapshot_cents,discount_cents,line_total_cents) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![sale_id,line.product_id,p.0,p.1,p.2,p.3,line.quantity,line.unit_price_cents,p.4,line.discount_cents,line_total]).map_err(db_err)?;
        if p.3 == "physical_product" {
            let after = p.5 - line.quantity;
            if after < 0 {
                return Err(format!("Stock insuffisant pour {}", p.0));
            }
            tx.execute(
                "UPDATE products SET current_stock=?1 WHERE id=?2",
                params![after, line.product_id],
            )
            .map_err(db_err)?;
            tx.execute("INSERT INTO stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by) VALUES(?1,'sale',?2,?3,?4,'sale',?5,'Vente',?6)",params![line.product_id,-line.quantity,p.5,after,sale_id,u.id]).map_err(db_err)?;
        }
    }
    if input.cash_paid_cents > 0 {
        tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) VALUES(?1,'sale',?2,'sale',?3,'Vente comptant',?4)",params![reg,input.cash_paid_cents,sale_id,u.id]).map_err(db_err)?;
    }
    if input.credit_amount_cents > 0 {
        let cid = input.customer_id.unwrap();
        let before: i64 = tx
            .query_row(
                "SELECT current_debt_cents FROM customers WHERE id=?1 AND is_active=1",
                [cid],
                |r| r.get(0),
            )
            .map_err(|_| "Client invalide".to_string())?;
        let after = before + input.credit_amount_cents;
        tx.execute(
            "UPDATE customers SET current_debt_cents=?1 WHERE id=?2",
            params![after, cid],
        )
        .map_err(db_err)?;
        tx.execute("INSERT INTO customer_credit_transactions(customer_id,sale_id,transaction_type,amount_cents,balance_after_cents,created_by) VALUES(?1,?2,'credit_sale',?3,?4,?5)",params![cid,sale_id,input.credit_amount_cents,after,u.id]).map_err(db_err)?;
    }
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?1,'sale.created','sale',?2)",params![u.id,sale_id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(json!({"id":sale_id,"saleNumber":sale_no,"duplicate":false}))
}

#[tauri::command]
fn list_customers(
    search: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "customers.view")?;
    simple_people(&db, "customers", search)
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn save_customer(
    id: Option<i64>,
    full_name: String,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    notes: Option<String>,
    credit_limit_cents: i64,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    current(
        &session,
        if id.is_some() {
            "customers.edit"
        } else {
            "customers.create"
        },
    )?;
    if full_name.trim().is_empty() || credit_limit_cents < 0 {
        return Err("Données client invalides".into());
    }
    let c = db.connect()?;
    if let Some(id) = id {
        c.execute("UPDATE customers SET full_name=?1,phone=?2,email=?3,address=?4,notes=?5,credit_limit_cents=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?7",params![full_name.trim(),text(phone),text(email),text(address),text(notes),credit_limit_cents,id]).map_err(db_err)?;
        Ok(id)
    } else {
        c.execute("INSERT INTO customers(full_name,phone,email,address,notes,credit_limit_cents) VALUES(?1,?2,?3,?4,?5,?6)",params![full_name.trim(),text(phone),text(email),text(address),text(notes),credit_limit_cents]).map_err(db_err)?;
        Ok(c.last_insert_rowid())
    }
}
fn simple_people(db: &Database, table: &str, search: Option<String>) -> Result<Value, String> {
    let c = db.connect()?;
    let term = format!("%{}%", search.unwrap_or_default());
    let sql=format!("SELECT id,{},coalesce(phone,''),coalesce(email,''),current_debt_cents,is_active FROM {} WHERE {} LIKE ?1 OR phone LIKE ?1 ORDER BY {} LIMIT 50",if table=="customers"{"full_name"}else{"name"},table,if table=="customers"{"full_name"}else{"name"},if table=="customers"{"full_name"}else{"name"});
    let mut q = c.prepare(&sql).map_err(db_err)?;
    let rows=q.query_map([term],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"phone":r.get::<_,String>(2)?,"email":r.get::<_,String>(3)?,"debtCents":r.get::<_,i64>(4)?,"isActive":r.get::<_,bool>(5)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!(rows))
}
#[tauri::command]
fn customer_payment(
    customer_id: i64,
    amount_cents: i64,
    notes: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<(), String> {
    let u = current(&session, "customers.credit.payment")?;
    if amount_cents <= 0 {
        return Err("Montant invalide".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let reg: i64 = tx
        .query_row(
            "SELECT id FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",
            [u.id],
            |r| r.get(0),
        )
        .map_err(|_| "Ouvrez la caisse avant d’encaisser".to_string())?;
    let debt: i64 = tx
        .query_row(
            "SELECT current_debt_cents FROM customers WHERE id=?1",
            [customer_id],
            |r| r.get(0),
        )
        .map_err(|_| "Client introuvable".to_string())?;
    if amount_cents > debt {
        return Err("Le paiement dépasse la dette".into());
    }
    let after = debt - amount_cents;
    tx.execute(
        "UPDATE customers SET current_debt_cents=?1 WHERE id=?2",
        params![after, customer_id],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO customer_credit_transactions(customer_id,transaction_type,amount_cents,balance_after_cents,notes,created_by) VALUES(?1,'payment',?2,?3,?4,?5)",params![customer_id,-amount_cents,after,text(notes),u.id]).map_err(db_err)?;
    tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) VALUES(?1,'customer_payment',?2,'customer',?3,'Règlement dette',?4)",params![reg,amount_cents,customer_id,u.id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(())
}

#[tauri::command]
fn get_settings(db: State<Database>, session: State<Session>) -> Result<Value, String> {
    current(&session, "dashboard.view")?;
    let c = db.connect()?;
    c.query_row("SELECT shop_name,coalesce(phone,''),coalesce(address,''),coalesce(receipt_footer,''),currency,barcode_prefix,low_stock_default,receipt_width,automatic_backup,backup_retention FROM app_settings WHERE id=1",[],|r|Ok(json!({"shopName":r.get::<_,String>(0)?,"phone":r.get::<_,String>(1)?,"address":r.get::<_,String>(2)?,"receiptFooter":r.get::<_,String>(3)?,"currency":r.get::<_,String>(4)?,"barcodePrefix":r.get::<_,String>(5)?,"lowStockDefault":r.get::<_,i64>(6)?,"receiptWidth":r.get::<_,i64>(7)?,"automaticBackup":r.get::<_,bool>(8)?,"backupRetention":r.get::<_,i64>(9)?}))).map_err(db_err)
}
#[tauri::command]
fn save_settings(value: Value, db: State<Database>, session: State<Session>) -> Result<(), String> {
    current(&session, "settings.manage")?;
    let shop = value["shopName"].as_str().unwrap_or("").trim();
    if shop.is_empty() {
        return Err("Nom du magasin obligatoire".into());
    }
    let c = db.connect()?;
    c.execute("UPDATE app_settings SET shop_name=?1,phone=?2,address=?3,receipt_footer=?4,low_stock_default=?5,receipt_width=?6,automatic_backup=?7,backup_retention=?8,updated_at=CURRENT_TIMESTAMP WHERE id=1",params![shop,value["phone"].as_str(),value["address"].as_str(),value["receiptFooter"].as_str(),value["lowStockDefault"].as_i64().unwrap_or(5),value["receiptWidth"].as_i64().unwrap_or(80),value["automaticBackup"].as_bool().unwrap_or(false),value["backupRetention"].as_i64().unwrap_or(7)]).map_err(db_err)?;
    Ok(())
}
#[tauri::command]
fn backup_database(
    destination: String,
    db: State<Database>,
    session: State<Session>,
) -> Result<String, String> {
    current(&session, "backup.manage")?;
    let _g = db.guard()?;
    let c = db.connect()?;
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(db_err)?;
    let target = PathBuf::from(destination);
    let mut out =
        rusqlite::Connection::open(&target).map_err(|_| "Destination inaccessible".to_string())?;
    let backup = rusqlite::backup::Backup::new(&c, &mut out).map_err(db_err)?;
    backup
        .run_to_completion(5, std::time::Duration::from_millis(50), None)
        .map_err(db_err)?;
    drop(backup);
    drop(out);
    Database::validate_file(&target)?;
    Ok(target.display().to_string())
}
#[tauri::command]
fn restore_database(
    source: String,
    db: State<Database>,
    session: State<Session>,
) -> Result<(), String> {
    current(&session, "backup.manage")?;
    let src = PathBuf::from(source);
    Database::validate_file(&src)?;
    let _g = db.guard()?;
    let safety = db.path.with_extension("before-restore.sqlite3");
    fs::copy(&db.path, &safety).map_err(|_| "Sauvegarde de sécurité impossible".to_string())?;
    fs::copy(&src, &db.path).map_err(|_| "Restauration impossible".to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Session::default())
        .setup(|app| {
            let db = Database::new(app.handle())?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            create_owner,
            login,
            logout,
            dashboard,
            list_categories,
            save_category,
            toggle_category,
            list_products,
            save_product,
            adjust_stock,
            current_register,
            open_register,
            close_register,
            create_sale,
            list_customers,
            save_customer,
            customer_payment,
            get_settings,
            save_settings,
            backup_database,
            restore_database,
            operations::list_suppliers,
            operations::save_supplier,
            operations::toggle_supplier,
            operations::supplier_payment,
            operations::create_purchase,
            operations::create_expense,
            operations::list_expenses,
            operations::correct_expense,
            operations::calculate_return_split,
            operations::calculate_denominations
        ])
        .run(tauri::generate_context!())
        .expect("error while running Maktaba POS")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn password_roundtrip() {
        let h = hash_password("Secret123").unwrap();
        assert!(verify_password("Secret123", &h));
        assert!(!verify_password("bad", &h))
    }
    #[test]
    fn password_strength() {
        assert!(strong("Secret123"));
        assert!(!strong("secret"))
    }
    #[test]
    fn permissions_are_role_based() {
        assert!(role_permissions("global_admin").contains(&"settings.manage".into()));
        assert!(!role_permissions("cashier").contains(&"settings.manage".into()))
    }
}
