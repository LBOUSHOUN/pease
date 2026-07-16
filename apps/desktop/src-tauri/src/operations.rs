use super::{current, db_err, text, Database, Session};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenominationInput {
    pub denomination_cents: i64,
    pub quantity: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnInput {
    pub sale_id: i64,
    pub reason: String,
    pub idempotency_key: String,
    pub items: Vec<ReturnLine>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnLine {
    pub sale_item_id: i64,
    pub quantity: i64,
    pub restock: bool,
    pub condition: String,
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
pub fn list_expenses(
    search: Option<String>,
    category: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    page: Option<i64>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "expenses.view")?;
    let c = db.connect()?;
    let term = format!("%{}%", search.unwrap_or_default());
    let mut q=c.prepare("SELECT e.id,e.category,e.description,e.amount_cents,e.expense_date,e.status,e.cash_register_session_id,u.full_name,coalesce(e.notes,''),e.correction_of_id FROM expenses e JOIN users u ON u.id=e.created_by WHERE e.description LIKE ?1 AND (?2 IS NULL OR e.category=?2) AND (?3 IS NULL OR e.expense_date>=?3) AND (?4 IS NULL OR e.expense_date<=?4) ORDER BY e.expense_date DESC,e.id DESC LIMIT 30 OFFSET ?5").map_err(db_err)?;
    let rows=q.query_map(params![term,category,date_from,date_to,(page.unwrap_or(1).max(1)-1)*30],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"category":r.get::<_,String>(1)?,"description":r.get::<_,String>(2)?,"amountCents":r.get::<_,i64>(3)?,"expenseDate":r.get::<_,String>(4)?,"status":r.get::<_,String>(5)?,"registerId":r.get::<_,i64>(6)?,"worker":r.get::<_,String>(7)?,"notes":r.get::<_,String>(8)?,"correctionOfId":r.get::<_,Option<i64>>(9)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!(rows))
}
#[tauri::command]
pub fn correct_expense(
    expense_id: i64,
    reason: String,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let u = current(&session, "expenses.correct")?;
    if reason.trim().is_empty() {
        return Err("Le motif de correction est obligatoire".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let (category,description,amount,reg,date):(String,String,i64,i64,String)=tx.query_row("SELECT category,description,amount_cents,cash_register_session_id,expense_date FROM expenses WHERE id=?1 AND status='active' AND correction_of_id IS NULL",[expense_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|"Cette dépense est introuvable ou déjà corrigée".to_string())?;
    tx.execute(
        "UPDATE expenses SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        [expense_id],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO expenses(category,description,amount_cents,cash_register_session_id,expense_date,status,correction_of_id,notes,created_by)VALUES(?1,?2,?3,?4,?5,'correction',?6,?7,?8)",params![category,format!("Annulation: {description}"),-amount,reg,date,expense_id,reason.trim(),u.id]).map_err(db_err)?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by)VALUES(?1,'cash_in',?2,'expense_correction',?3,?4,?5)",params![reg,amount,id,reason.trim(),u.id]).map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,old_values_json,new_values_json)VALUES(?1,'expense.corrected','expense',?2,?3,?4)",params![u.id,expense_id,json!({"status":"active","amountCents":amount}).to_string(),json!({"status":"reversed","correctionId":id,"reason":reason}).to_string()]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(id)
}

#[tauri::command]
pub fn calculate_denominations(lines: Vec<DenominationInput>) -> Result<i64, String> {
    denomination_total(&lines)
}

#[tauri::command]
pub fn sale_for_return(
    sale_id: i64,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "sales.return")?;
    let c = db.connect()?;
    let sale=c.query_row("SELECT s.id,s.sale_number,s.created_at,s.payment_type,s.cash_paid_cents,s.credit_amount_cents,s.status,coalesce(c.full_name,''),u.full_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.cashier_id WHERE s.id=?1",[sale_id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"saleNumber":r.get::<_,String>(1)?,"createdAt":r.get::<_,String>(2)?,"paymentType":r.get::<_,String>(3)?,"cashPaidCents":r.get::<_,i64>(4)?,"creditAmountCents":r.get::<_,i64>(5)?,"status":r.get::<_,String>(6)?,"customer":r.get::<_,String>(7)?,"cashier":r.get::<_,String>(8)?}))).map_err(|_|"Vente introuvable".to_string())?;
    let mut q=c.prepare("SELECT id,product_id,product_name_snapshot,product_type_snapshot,quantity,returned_quantity,unit_price_cents,line_total_cents FROM sale_items WHERE sale_id=?1").map_err(db_err)?;
    let items=q.query_map([sale_id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"productId":r.get::<_,i64>(1)?,"name":r.get::<_,String>(2)?,"productType":r.get::<_,String>(3)?,"quantity":r.get::<_,i64>(4)?,"returnedQuantity":r.get::<_,i64>(5)?,"unitPriceCents":r.get::<_,i64>(6)?,"lineTotalCents":r.get::<_,i64>(7)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    let mut h=c.prepare("SELECT return_number,created_at,total_return_value_cents,customer_debt_reduction_cents,cash_refund_cents,reason FROM returns WHERE original_sale_id=?1 ORDER BY id DESC").map_err(db_err)?;
    let history=h.query_map([sale_id],|r|Ok(json!({"returnNumber":r.get::<_,String>(0)?,"createdAt":r.get::<_,String>(1)?,"totalCents":r.get::<_,i64>(2)?,"debtReductionCents":r.get::<_,i64>(3)?,"cashRefundCents":r.get::<_,i64>(4)?,"reason":r.get::<_,String>(5)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!({"sale":sale,"items":items,"history":history}))
}

#[tauri::command]
pub fn create_return(
    input: ReturnInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    let u = current(&session, "sales.return")?;
    if input.reason.trim().is_empty()
        || input.items.is_empty()
        || input.idempotency_key.trim().is_empty()
    {
        return Err("Motif et articles retournés obligatoires".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    if tx
        .query_row(
            "SELECT id FROM audit_logs WHERE action='return.idempotency' AND new_values_json=?1",
            [&input.idempotency_key],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(db_err)?
        .is_some()
    {
        return Err("Ce retour a déjà été enregistré".into());
    }
    let (customer,cash,credit):(Option<i64>,i64,i64)=tx.query_row("SELECT customer_id,cash_paid_cents,credit_amount_cents FROM sales WHERE id=?1 AND status IN('completed','partially_returned')",[input.sale_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"Vente non retournable".to_string())?;
    let prior:(i64,i64)=tx.query_row("SELECT coalesce(sum(customer_debt_reduction_cents),0),coalesce(sum(cash_refund_cents),0) FROM returns WHERE original_sale_id=?1",[input.sale_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_err)?;
    let mut prepared = Vec::new();
    let mut total = 0;
    for x in &input.items {
        if x.quantity <= 0 {
            return Err("Quantité de retour invalide".into());
        }
        let row:(i64,String,i64,i64,i64)=tx.query_row("SELECT product_id,product_type_snapshot,quantity,returned_quantity,line_total_cents FROM sale_items WHERE id=?1 AND sale_id=?2",params![x.sale_item_id,input.sale_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|"Article de vente invalide".to_string())?;
        if x.quantity > row.2 - row.3 {
            return Err("La quantité dépasse le solde retournable".into());
        }
        let amount = row.4 * x.quantity / row.2;
        total += amount;
        prepared.push((x, row, amount));
    }
    let (debt_refund, cash_refund) =
        calculate_return_split(total, (credit - prior.0).max(0), (cash - prior.1).max(0))?;
    let reg = if cash_refund > 0 {
        Some(
            tx.query_row(
                "SELECT id FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",
                [u.id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|_| "Ouvrez la caisse pour effectuer le remboursement".to_string())?,
        )
    } else {
        None
    };
    let number = format!(
        "R-{}-{:06}",
        chrono::Local::now().format("%Y%m%d"),
        tx.query_row("SELECT count(*)+1 FROM returns", [], |r| r.get::<_, i64>(0))
            .map_err(db_err)?
    );
    tx.execute("INSERT INTO returns(return_number,original_sale_id,customer_id,cash_register_session_id,total_return_value_cents,customer_debt_reduction_cents,cash_refund_cents,reason,created_by)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![number,input.sale_id,customer,reg,total,debt_refund,cash_refund,input.reason.trim(),u.id]).map_err(db_err)?;
    let rid = tx.last_insert_rowid();
    for (x, row, amount) in prepared {
        tx.execute(
            "UPDATE sale_items SET returned_quantity=returned_quantity+?1 WHERE id=?2",
            params![x.quantity, x.sale_item_id],
        )
        .map_err(db_err)?;
        tx.execute("INSERT INTO return_items(return_id,sale_item_id,product_id,quantity,amount_cents,condition,restock)VALUES(?1,?2,?3,?4,?5,?6,?7)",params![rid,x.sale_item_id,row.0,x.quantity,amount,x.condition,x.restock]).map_err(db_err)?;
        if row.1 == "physical_product" && x.restock {
            let before: i64 = tx
                .query_row(
                    "SELECT current_stock FROM products WHERE id=?1",
                    [row.0],
                    |r| r.get(0),
                )
                .map_err(db_err)?;
            tx.execute(
                "UPDATE products SET current_stock=current_stock+?1 WHERE id=?2",
                params![x.quantity, row.0],
            )
            .map_err(db_err)?;
            tx.execute("INSERT INTO stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by)VALUES(?1,'customer_return',?2,?3,?4,'return',?5,'Retour client',?6)",params![row.0,x.quantity,before,before+x.quantity,rid,u.id]).map_err(db_err)?;
        }
    }
    if debt_refund > 0 {
        let cid = customer.ok_or("Client absent pour la dette")?;
        let debt: i64 = tx
            .query_row(
                "SELECT current_debt_cents FROM customers WHERE id=?1",
                [cid],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        let reduction = debt_refund.min(debt);
        let after = debt - reduction;
        tx.execute(
            "UPDATE customers SET current_debt_cents=?1 WHERE id=?2",
            params![after, cid],
        )
        .map_err(db_err)?;
        tx.execute("INSERT INTO customer_credit_transactions(customer_id,sale_id,transaction_type,amount_cents,balance_after_cents,notes,created_by)VALUES(?1,?2,'return',?3,?4,?5,?6)",params![cid,input.sale_id,-reduction,after,input.reason,u.id]).map_err(db_err)?;
    }
    if let Some(reg) = reg {
        tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by)VALUES(?1,'refund',?2,'return',?3,?4,?5)",params![reg,cash_refund,rid,input.reason,u.id]).map_err(db_err)?;
    }
    let remaining: i64 = tx
        .query_row(
            "SELECT coalesce(sum(quantity-returned_quantity),0) FROM sale_items WHERE sale_id=?1",
            [input.sale_id],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    tx.execute(
        "UPDATE sales SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
        params![
            if remaining == 0 {
                "returned"
            } else {
                "partially_returned"
            },
            input.sale_id
        ],
    )
    .map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values_json)VALUES(?1,'return.idempotency','return',?2,?3)",params![u.id,rid,input.idempotency_key]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(
        json!({"id":rid,"returnNumber":number,"totalCents":total,"debtReductionCents":debt_refund,"cashRefundCents":cash_refund}),
    )
}
fn denomination_total(lines: &[DenominationInput]) -> Result<i64, String> {
    let allowed = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
    let mut total = 0i64;
    for x in lines {
        if !allowed.contains(&x.denomination_cents) || x.quantity < 0 {
            return Err("Comptage de caisse invalide".into());
        }
        total = total
            .checked_add(
                x.denomination_cents
                    .checked_mul(x.quantity)
                    .ok_or("Montant trop élevé")?,
            )
            .ok_or("Montant trop élevé")?;
    }
    Ok(total)
}
#[tauri::command]
pub fn close_register_with_denominations(
    lines: Vec<DenominationInput>,
    difference_reason: Option<String>,
    note: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    let u = current(&session, "register.close")?;
    let actual = denomination_total(&lines)?;
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    let (id,opening):(i64,i64)=tx.query_row("SELECT id,opening_amount_cents FROM cash_register_sessions WHERE cashier_id=?1 AND status='open'",[u.id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"Aucune caisse ouverte".to_string())?;
    let net:i64=tx.query_row("SELECT coalesce(sum(CASE WHEN movement_type IN('sale','customer_payment','cash_in') THEN amount_cents WHEN movement_type IN('purchase_payment','supplier_payment','expense','refund','cash_out') THEN -amount_cents ELSE 0 END),0) FROM cash_movements WHERE cash_register_session_id=?1",[id],|r|r.get(0)).map_err(db_err)?;
    let expected = opening + net;
    let difference = actual - expected;
    if difference != 0 && text(difference_reason.clone()).is_none() {
        return Err("Un motif est obligatoire en cas d’écart".into());
    }
    for x in lines {
        if x.quantity > 0 {
            tx.execute("INSERT INTO cash_register_denominations(cash_register_session_id,denomination_cents,quantity,total_cents)VALUES(?1,?2,?3,?4)",params![id,x.denomination_cents,x.quantity,x.denomination_cents*x.quantity]).map_err(db_err)?;
        }
    }
    tx.execute("UPDATE cash_register_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP,expected_closing_cents=?1,actual_closing_cents=?2,difference_cents=?3,difference_reason=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?5 AND status='open'",params![expected,actual,difference,text(difference_reason),id]).map_err(db_err)?;
    tx.execute("INSERT INTO cash_movements(cash_register_session_id,movement_type,amount_cents,reason,created_by)VALUES(?1,'closing',?2,?3,?4)",params![id,actual,text(note),u.id]).map_err(db_err)?;
    tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values_json)VALUES(?1,'register.closed','cash_register',?2,?3)",params![u.id,id,json!({"expectedCents":expected,"actualCents":actual,"differenceCents":difference}).to_string()]).map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(json!({"id":id,"expectedCents":expected,"actualCents":actual,"differenceCents":difference}))
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
    #[test]
    fn denominations_use_integer_centimes() {
        assert_eq!(
            denomination_total(&[
                DenominationInput {
                    denomination_cents: 20000,
                    quantity: 2
                },
                DenominationInput {
                    denomination_cents: 50,
                    quantity: 3
                }
            ])
            .unwrap(),
            40150
        );
    }
}
