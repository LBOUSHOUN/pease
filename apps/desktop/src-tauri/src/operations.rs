use super::{current, db_err, text, Database, Session};
use rusqlite::params;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierInput {
    pub id: Option<i64>,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseInput {
    pub supplier_id: i64,
    pub paid_cents: i64,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<PurchaseLine>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseLine {
    pub product_id: i64,
    pub quantity: i64,
    pub unit_purchase_price_cents: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseInput {
    pub category: String,
    pub description: String,
    pub amount_cents: i64,
    pub expense_date: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn list_suppliers(
    search: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "suppliers.view")?;
    super::simple_people(&db, "suppliers", search)
}
#[tauri::command]
pub fn save_supplier(
    input: SupplierInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    current(&session, "suppliers.manage")?;
    if input.name.trim().is_empty() {
        return Err("Le nom du fournisseur est obligatoire".into());
    }
    let c = db.connect()?;
    if let Some(id) = input.id {
        c.execute("UPDATE suppliers SET name=?1,contact_name=?2,phone=?3,email=?4,address=?5,notes=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?7",params![input.name.trim(),text(input.contact_name),text(input.phone),text(input.email),text(input.address),text(input.notes),id]).map_err(db_err)?;
        Ok(id)
    } else {
        c.execute("INSERT INTO suppliers(name,contact_name,phone,email,address,notes)VALUES(?1,?2,?3,?4,?5,?6)",params![input.name.trim(),text(input.contact_name),text(input.phone),text(input.email),text(input.address),text(input.notes)]).map_err(db_err)?;
        Ok(c.last_insert_rowid())
    }
}
#[tauri::command]
pub fn toggle_supplier(
    id: i64,
    active: bool,
    db: State<Database>,
    session: State<Session>,
) -> Result<(), String> {
    current(&session, "suppliers.manage")?;
    let c = db.connect()?;
    c.execute(
        "UPDATE suppliers SET is_active=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
        params![active, id],
    )
    .map_err(db_err)?;
    Ok(())
}
#[tauri::command]
pub fn supplier_payment(
    supplier_id: i64,
    amount_cents: i64,
    notes: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "suppliers.payment")?;
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
        .map_err(|_| "Ouvrez la caisse avant de payer".to_string())?;
    let debt: i64 = tx
        .query_row(
            "SELECT current_debt_cents FROM suppliers WHERE id=?1 AND is_active=1",
            [supplier_id],
            |r| r.get(0),
        )
        .map_err(|_| "Fournisseur invalide".to_string())?;
    if amount_cents > debt {
        return Err("Le paiement dépasse la dette fournisseur".into());
    }
    tx.execute(
        "UPDATE suppliers SET current_debt_cents=current_debt_cents-?1 WHERE id=?2",
        params![amount_cents, supplier_id],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO supplier_payments(supplier_id,cash_register_session_id,amount_cents,notes,created_by)VALUES(?1,?2,?3,?4,?5)",params![supplier_id,reg,amount_cents,text(notes),u.id]).map_err(db_err)?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by)VALUES(?1,'supplier_payment',?2,'supplier_payment',?3,'Paiement fournisseur',?4)",params![reg,amount_cents,id,u.id]).map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'supplier.payment','supplier',?2)",params![u.id,supplier_id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(id)
}
#[tauri::command]
pub fn create_purchase(
    input: PurchaseInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "purchases.create")?;
    if input.items.is_empty() || input.paid_cents < 0 {
        return Err("Aucune ligne d’achat valide".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let _: i64 = tx
        .query_row(
            "SELECT id FROM suppliers WHERE id=?1 AND is_active=1",
            [input.supplier_id],
            |r| r.get(0),
        )
        .map_err(|_| "Fournisseur invalide".to_string())?;
    let total: i64 = input
        .items
        .iter()
        .map(|x| x.quantity * x.unit_purchase_price_cents)
        .sum();
    if input
        .items
        .iter()
        .any(|x| x.quantity <= 0 || x.unit_purchase_price_cents < 0)
        || input.paid_cents > total
    {
        return Err("Quantité, prix ou paiement invalide".into());
    }
    let reg = if input.paid_cents > 0 {
        Some(
            tx.query_row(
                "SELECT id FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",
                [u.id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|_| "Ouvrez la caisse avant un paiement".to_string())?,
        )
    } else {
        None
    };
    let no = format!(
        "A-{}-{:06}",
        chrono::Local::now().format("%Y%m%d"),
        tx.query_row("SELECT count(*)+1 FROM purchases", [], |r| r
            .get::<_, i64>(0))
            .map_err(db_err)?
    );
    let remaining = total - input.paid_cents;
    tx.execute("INSERT INTO purchases(purchase_number,supplier_id,cash_register_session_id,subtotal_cents,total_cents,paid_cents,remaining_cents,reference,notes,created_by)VALUES(?1,?2,?3,?4,?4,?5,?6,?7,?8,?9)",params![no,input.supplier_id,reg,total,input.paid_cents,remaining,text(input.reference),text(input.notes),u.id]).map_err(db_err)?;
    let id = tx.last_insert_rowid();
    for x in input.items {
        let (kind,before,old):(String,i64,i64)=tx.query_row("SELECT product_type,current_stock,purchase_price_cents FROM products WHERE id=?1 AND is_active=1",[x.product_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"Produit invalide".to_string())?;
        tx.execute("INSERT INTO purchase_items(purchase_id,product_id,quantity,unit_purchase_price_cents,line_total_cents)VALUES(?1,?2,?3,?4,?5)",params![id,x.product_id,x.quantity,x.unit_purchase_price_cents,x.quantity*x.unit_purchase_price_cents]).map_err(db_err)?;
        if kind == "physical_product" {
            let after = before + x.quantity;
            tx.execute(
                "UPDATE products SET current_stock=?1,purchase_price_cents=?2 WHERE id=?3",
                params![after, x.unit_purchase_price_cents, x.product_id],
            )
            .map_err(db_err)?;
            tx.execute("INSERT INTO stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by)VALUES(?1,'purchase',?2,?3,?4,'purchase',?5,'Achat fournisseur',?6)",params![x.product_id,x.quantity,before,after,id,u.id]).map_err(db_err)?;
            if old != x.unit_purchase_price_cents {
                tx.execute("INSERT INTO product_price_history(product_id,price_type,old_value_cents,new_value_cents,reason,changed_by)VALUES(?1,'purchase_price',?2,?3,'Achat fournisseur',?4)",params![x.product_id,old,x.unit_purchase_price_cents,u.id]).map_err(db_err)?;
            }
        }
    }
    if remaining > 0 {
        tx.execute(
            "UPDATE suppliers SET current_debt_cents=current_debt_cents+?1 WHERE id=?2",
            params![remaining, input.supplier_id],
        )
        .map_err(db_err)?;
    }
    if let Some(reg) = reg {
        tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by)VALUES(?1,'purchase_payment',?2,'purchase',?3,'Achat fournisseur',?4)",params![reg,input.paid_cents,id,u.id]).map_err(db_err)?;
    }
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'purchase.created','purchase',?2)",params![u.id,id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(id)
}
#[tauri::command]
pub fn create_expense(
    input: ExpenseInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "expenses.create")?;
    if input.amount_cents <= 0 || input.description.trim().is_empty() {
        return Err("Dépense invalide".into());
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
        .map_err(|_| "Ouvrez la caisse".to_string())?;
    tx.execute("INSERT INTO expenses(category,description,amount_cents,cash_register_session_id,expense_date,notes,created_by)VALUES(?1,?2,?3,?4,?5,?6,?7)",params![input.category,input.description.trim(),input.amount_cents,reg,input.expense_date,text(input.notes),u.id]).map_err(db_err)?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by)VALUES(?1,'expense',?2,'expense',?3,?4,?5)",params![reg,input.amount_cents,id,input.description,u.id]).map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'expense.created','expense',?2)",params![u.id,id]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(id)
}
#[tauri::command]
pub fn calculate_return_split(
    value: i64,
    remaining_credit: i64,
    remaining_cash: i64,
) -> Result<(i64, i64), String> {
    if value <= 0 || value > remaining_credit + remaining_cash {
        return Err("Montant de retour invalide".into());
    }
    let debt = value.min(remaining_credit);
    Ok((debt, value - debt))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credit_is_reduced_before_cash() {
        assert_eq!(
            calculate_return_split(10000, 30000, 20000).unwrap(),
            (10000, 0)
        );
        assert_eq!(
            calculate_return_split(40000, 30000, 20000).unwrap(),
            (30000, 10000)
        );
    }
    #[test]
    fn over_return_rejected() {
        assert!(calculate_return_split(50001, 30000, 20000).is_err())
    }
}
