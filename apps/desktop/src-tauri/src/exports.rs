use super::{current, db_err, Database, Session};
use csv::WriterBuilder;
use rusqlite::params;
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::State;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    cancelled: bool,
    path: String,
    export_type: String,
    row_count: usize,
    file_size: u64,
}
pub fn safe_cell(value: String) -> String {
    if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{value}")
    } else {
        value
    }
}
fn permission(kind: &str) -> Result<&'static str, String> {
    match kind {
        "products" => Ok("exports.products"),
        "customers" => Ok("exports.customers"),
        "suppliers" => Ok("exports.suppliers"),
        "sales" => Ok("exports.sales"),
        "stock" => Ok("exports.stock"),
        "expenses" | "returns" | "registers" => Ok("exports.financials"),
        "workers" => Ok("exports.audit"),
        _ => Err("Type d’export invalide".into()),
    }
}
#[tauri::command]
pub fn export_csv(
    kind: String,
    destination: String,
    start: Option<String>,
    end: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<ExportResult, String> {
    current(&session, permission(&kind)?)?;
    if let (Some(a), Some(b)) = (&start, &end) {
        super::reports::validate_dates(a, b)?
    }
    let path = PathBuf::from(destination);
    let c = db.connect()?;
    let mut w = WriterBuilder::new()
        .delimiter(b';')
        .terminator(csv::Terminator::CRLF)
        .from_writer(vec![0xEF, 0xBB, 0xBF]);
    let mut count = 0usize;
    match kind.as_str() {
        "products" | "stock" => {
            w.write_record([
                "Produit",
                "Catégorie",
                "SKU",
                "Code interne",
                "Prix achat",
                "Prix vente",
                "Stock",
            ])
            .map_err(|_| "Export impossible")?;
            let mut q=c.prepare("SELECT p.name,coalesce(c.name,''),coalesce(p.sku,''),p.internal_barcode,p.purchase_price_cents,p.selling_price_cents,p.current_stock FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.name").map_err(db_err)?;
            let rows = q
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, i64>(6)?,
                    ))
                })
                .map_err(db_err)?;
            for x in rows {
                let x = x.map_err(db_err)?;
                w.write_record([
                    safe_cell(x.0),
                    safe_cell(x.1),
                    safe_cell(x.2),
                    safe_cell(x.3),
                    x.4.to_string(),
                    x.5.to_string(),
                    x.6.to_string(),
                ])
                .map_err(|_| "Export impossible")?;
                count += 1
            }
        }
        "customers" | "suppliers" => {
            let table = if kind == "customers" {
                "customers"
            } else {
                "suppliers"
            };
            let name = if kind == "customers" {
                "full_name"
            } else {
                "name"
            };
            w.write_record(["Nom", "Téléphone", "E-mail", "Dette centimes", "Actif"])
                .map_err(|_| "Export impossible")?;
            let mut q=c.prepare(&format!("SELECT {name},coalesce(phone,''),coalesce(email,''),current_debt_cents,is_active FROM {table} ORDER BY {name}")).map_err(db_err)?;
            let rows = q
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, bool>(4)?,
                    ))
                })
                .map_err(db_err)?;
            for x in rows {
                let x = x.map_err(db_err)?;
                w.write_record([
                    safe_cell(x.0),
                    safe_cell(x.1),
                    safe_cell(x.2),
                    x.3.to_string(),
                    x.4.to_string(),
                ])
                .map_err(|_| "Export impossible")?;
                count += 1
            }
        }
        "sales" => {
            w.write_record(["Numéro", "Date", "Total", "Espèces", "Crédit", "Statut"])
                .map_err(|_| "Export impossible")?;
            let mut q=c.prepare("SELECT sale_number,created_at,total_cents,cash_paid_cents,credit_amount_cents,status FROM sales WHERE (?1 IS NULL OR date(created_at)>=?1) AND (?2 IS NULL OR date(created_at)<=?2) ORDER BY id").map_err(db_err)?;
            let rows = q
                .query_map(params![start, end], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, String>(5)?,
                    ))
                })
                .map_err(db_err)?;
            for x in rows {
                let x = x.map_err(db_err)?;
                w.write_record([
                    safe_cell(x.0),
                    x.1,
                    x.2.to_string(),
                    x.3.to_string(),
                    x.4.to_string(),
                    x.5,
                ])
                .map_err(|_| "Export impossible")?;
                count += 1
            }
        }
        _ => {
            w.write_record(["Type", "Date début", "Date fin", "Note"])
                .map_err(|_| "Export impossible")?;
            w.write_record([
                kind.clone(),
                start.unwrap_or_default(),
                end.unwrap_or_default(),
                "Export synthétique; utiliser le rapport pour le détail".into(),
            ])
            .map_err(|_| "Export impossible")?;
            count = 1
        }
    }
    let bytes = w.into_inner().map_err(|_| "Export impossible")?;
    fs::write(&path, &bytes).map_err(|_| "Destination inaccessible")?;
    Ok(ExportResult {
        cancelled: false,
        path: path.display().to_string(),
        export_type: kind,
        row_count: count,
        file_size: bytes.len() as u64,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formula_injection_is_neutralized() {
        for c in ['=', '+', '-', '@', '\t', '\r'] {
            assert!(safe_cell(format!("{c}test")).starts_with('\''))
        }
        assert_eq!(safe_cell("École; Maroc".into()), "École; Maroc")
    }
    #[test]
    fn csv_writer_escapes() {
        let mut w = WriterBuilder::new().delimiter(b';').from_writer(vec![]);
        w.write_record(["a;b", "ligne\n2", "\"oui\""]).unwrap();
        let s = String::from_utf8(w.into_inner().unwrap()).unwrap();
        assert!(s.contains("\"a;b\""));
        assert!(s.contains("\"ligne\n2\""));
    }
}
