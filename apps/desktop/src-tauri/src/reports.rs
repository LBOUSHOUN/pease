use super::{current, db_err, Database, Session};
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;
pub fn validate_dates(start: &str, end: &str) -> Result<(), String> {
    let a = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|_| "Date de début invalide")?;
    let b =
        chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").map_err(|_| "Date de fin invalide")?;
    if b < a {
        return Err("La date de fin précède la date de début".into());
    }
    if (b - a).num_days() > 731 {
        return Err("La période ne peut pas dépasser deux ans".into());
    }
    Ok(())
}
fn permission(kind: &str) -> Result<&'static str, String> {
    match kind {
        "sales" => Ok("reports.sales"),
        "profit" => Ok("reports.profit"),
        "stock" => Ok("reports.stock"),
        "customers" => Ok("reports.customers"),
        "suppliers" => Ok("reports.suppliers"),
        "expenses" => Ok("reports.expenses"),
        "workers" => Ok("reports.workers"),
        "daily_closing" => Ok("reports.daily_closing"),
        _ => Err("Type de rapport invalide".into()),
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_report(
    kind: String,
    start: String,
    end: String,
    search: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    validate_dates(&start, &end)?;
    current(&session, permission(&kind)?)?;
    let c = db.connect()?;
    let size = page_size.unwrap_or(25).clamp(1, 100);
    let page = page.unwrap_or(1).max(1);
    let offset = (page - 1) * size;
    let term = format!("%{}%", search.unwrap_or_default());
    let (summary, rows, total) = match kind.as_str() {
        "sales" => {
            let s=c.query_row("SELECT coalesce(sum(total_cents),0),coalesce((SELECT sum(total_return_value_cents) FROM returns WHERE date(created_at) BETWEEN ?1 AND ?2),0),coalesce(sum(cash_paid_cents),0),coalesce(sum(credit_amount_cents),0),count(*) FROM sales WHERE date(created_at) BETWEEN ?1 AND ?2 AND status!='cancelled'",params![start,end],|r|Ok(json!({"grossCents":r.get::<_,i64>(0)?,"returnedCents":r.get::<_,i64>(1)?,"cashCents":r.get::<_,i64>(2)?,"creditCents":r.get::<_,i64>(3)?,"count":r.get::<_,i64>(4)?}))).map_err(db_err)?;
            let total:i64=c.query_row("SELECT count(*) FROM sales WHERE date(created_at) BETWEEN ?1 AND ?2 AND sale_number LIKE ?3",params![start,end,term],|r|r.get(0)).map_err(db_err)?;
            let mut q=c.prepare("SELECT s.sale_number,s.created_at,u.full_name,coalesce(c.full_name,''),s.payment_type,s.total_cents,coalesce(sum(r.total_return_value_cents),0),s.status FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN returns r ON r.original_sale_id=s.id WHERE date(s.created_at) BETWEEN ?1 AND ?2 AND s.sale_number LIKE ?3 GROUP BY s.id ORDER BY s.id DESC LIMIT ?4 OFFSET ?5").map_err(db_err)?;
            let rows=q.query_map(params![start,end,term,size,offset],|r|{let gross:i64=r.get(5)?;let ret:i64=r.get(6)?;Ok(json!({"number":r.get::<_,String>(0)?,"date":r.get::<_,String>(1)?,"cashier":r.get::<_,String>(2)?,"customer":r.get::<_,String>(3)?,"payment":r.get::<_,String>(4)?,"grossCents":gross,"returnedCents":ret,"netCents":gross-ret,"status":r.get::<_,String>(7)?}))}).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
            (s, rows, total)
        }
        "profit" => {
            let (rev,cost):(i64,i64)=c.query_row("SELECT coalesce(sum(si.line_total_cents*(si.quantity-si.returned_quantity)/si.quantity),0),coalesce(sum(si.purchase_price_snapshot_cents*(si.quantity-si.returned_quantity)),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE date(s.created_at) BETWEEN ?1 AND ?2 AND s.status!='cancelled'",params![start,end],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_err)?;
            let exp:i64=c.query_row("SELECT coalesce(sum(amount_cents),0) FROM expenses WHERE expense_date BETWEEN ?1 AND ?2",params![start,end],|r|r.get(0)).map_err(db_err)?;
            (
                json!({"revenueCents":rev,"costCents":cost,"grossProfitCents":rev-cost,"expensesCents":exp,"netCents":rev-cost-exp,"margin":if rev>0{(rev-cost)*100/rev}else{0}}),
                vec![],
                0,
            )
        }
        "stock" => {
            let s=c.query_row("SELECT count(*),coalesce(sum(current_stock),0),coalesce(sum(current_stock*purchase_price_cents),0),coalesce(sum(current_stock*selling_price_cents),0),coalesce(sum(current_stock<=minimum_stock),0),coalesce(sum(current_stock=0),0) FROM products WHERE product_type='physical_product' AND is_active=1",[],|r|Ok(json!({"count":r.get::<_,i64>(0)?,"units":r.get::<_,i64>(1)?,"valueCents":r.get::<_,i64>(2)?,"sellingValueCents":r.get::<_,i64>(3)?,"low":r.get::<_,i64>(4)?,"out":r.get::<_,i64>(5)?}))).map_err(db_err)?;
            let total:i64=c.query_row("SELECT count(*) FROM products WHERE product_type='physical_product' AND name LIKE ?1",[&term],|r|r.get(0)).map_err(db_err)?;
            let mut q=c.prepare("SELECT p.name,coalesce(c.name,''),coalesce(p.sku,''),p.current_stock,p.minimum_stock,p.purchase_price_cents,p.selling_price_cents FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.product_type='physical_product' AND p.name LIKE ?1 ORDER BY p.name LIMIT ?2 OFFSET ?3").map_err(db_err)?;
            let rows=q.query_map(params![term,size,offset],|r|{let stock:i64=r.get(3)?;let purchase:i64=r.get(5)?;Ok(json!({"name":r.get::<_,String>(0)?,"category":r.get::<_,String>(1)?,"sku":r.get::<_,String>(2)?,"stock":stock,"minimum":r.get::<_,i64>(4)?,"purchaseCents":purchase,"sellingCents":r.get::<_,i64>(6)?,"valueCents":stock*purchase}))}).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
            (s, rows, total)
        }
        "customers" => people_report(&c, true, &start, &end, &term, size, offset)?,
        "suppliers" => people_report(&c, false, &start, &end, &term, size, offset)?,
        "expenses" => {
            let s=c.query_row("SELECT coalesce(sum(CASE WHEN correction_of_id IS NULL THEN amount_cents ELSE 0 END),0),coalesce(sum(CASE WHEN correction_of_id IS NOT NULL THEN -amount_cents ELSE 0 END),0),coalesce(sum(amount_cents),0),count(*) FROM expenses WHERE expense_date BETWEEN ?1 AND ?2",params![start,end],|r|Ok(json!({"grossCents":r.get::<_,i64>(0)?,"correctionCents":r.get::<_,i64>(1)?,"netCents":r.get::<_,i64>(2)?,"count":r.get::<_,i64>(3)?}))).map_err(db_err)?;
            let total:i64=c.query_row("SELECT count(*) FROM expenses WHERE expense_date BETWEEN ?1 AND ?2 AND description LIKE ?3",params![start,end,term],|r|r.get(0)).map_err(db_err)?;
            let mut q=c.prepare("SELECT expense_date,category,description,amount_cents,status FROM expenses WHERE expense_date BETWEEN ?1 AND ?2 AND description LIKE ?3 ORDER BY id DESC LIMIT ?4 OFFSET ?5").map_err(db_err)?;
            let rows=q.query_map(params![start,end,term,size,offset],|r|Ok(json!({"date":r.get::<_,String>(0)?,"category":r.get::<_,String>(1)?,"description":r.get::<_,String>(2)?,"amountCents":r.get::<_,i64>(3)?,"status":r.get::<_,String>(4)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
            (s, rows, total)
        }
        _ => {
            let total: i64 = c
                .query_row(
                    "SELECT count(*) FROM users WHERE full_name LIKE ?1",
                    [&term],
                    |r| r.get(0),
                )
                .map_err(db_err)?;
            let mut q=c.prepare("SELECT full_name,username,role,is_active,last_login_at FROM users WHERE full_name LIKE ?1 ORDER BY full_name LIMIT ?2 OFFSET ?3").map_err(db_err)?;
            let rows=q.query_map(params![term,size,offset],|r|Ok(json!({"name":r.get::<_,String>(0)?,"username":r.get::<_,String>(1)?,"role":r.get::<_,String>(2)?,"active":r.get::<_,bool>(3)?,"lastLogin":r.get::<_,Option<String>>(4)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
            (json!({"count":total}), rows, total)
        }
    };
    Ok(
        json!({"kind":kind,"start":start,"end":end,"summary":summary,"rows":rows,"page":page,"pageSize":size,"totalRows":total,"totalPages":(total+size-1)/size}),
    )
}
fn people_report(
    c: &rusqlite::Connection,
    customers: bool,
    start: &str,
    end: &str,
    term: &str,
    size: i64,
    offset: i64,
) -> Result<(Value, Vec<Value>, i64), String> {
    let table = if customers { "customers" } else { "suppliers" };
    let name = if customers { "full_name" } else { "name" };
    let total: i64 = c
        .query_row(
            &format!("SELECT count(*) FROM {table} WHERE {name} LIKE ?1"),
            [term],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    let summary=c.query_row(&format!("SELECT count(*),coalesce(sum(current_debt_cents>0),0),coalesce(sum(current_debt_cents),0) FROM {table} WHERE is_active=1"),[],|r|Ok(json!({"count":r.get::<_,i64>(0)?,"withDebt":r.get::<_,i64>(1)?,"debtCents":r.get::<_,i64>(2)?}))).map_err(db_err)?;
    let mut q=c.prepare(&format!("SELECT {name},coalesce(phone,''),current_debt_cents FROM {table} WHERE {name} LIKE ?1 ORDER BY {name} LIMIT ?2 OFFSET ?3")).map_err(db_err)?;
    let rows=q.query_map(params![term,size,offset],|r|Ok(json!({"name":r.get::<_,String>(0)?,"phone":r.get::<_,String>(1)?,"debtCents":r.get::<_,i64>(2)?,"period":format!("{start}..{end}")}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok((summary, rows, total))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_dates() {
        assert!(validate_dates("2026-01-01", "2026-01-31").is_ok());
        assert!(validate_dates("2026-02-01", "2026-01-01").is_err());
        assert!(validate_dates("bad", "2026-01-01").is_err())
    }
}
