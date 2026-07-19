use super::{
    current, db_err, hash_password, role_permissions, strong, text, verify_password, Database,
    SafeUser, Session,
};
use rand_core::{OsRng, RngCore};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerInput {
    pub id: Option<i64>,
    pub full_name: String,
    pub username: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub temporary_password: Option<String>,
}
fn validate_role(actor: &SafeUser, target: &str, existing: Option<&str>) -> Result<(), String> {
    if !["global_admin", "manager", "cashier", "stock_worker"].contains(&target) {
        return Err("Rôle invalide".into());
    }
    if actor.role != "global_admin"
        && (target == "global_admin" || existing == Some("global_admin"))
    {
        return Err("Seul l’administrateur global peut gérer ce rôle".into());
    }
    Ok(())
}
#[tauri::command]
pub fn list_workers(
    search: Option<String>,
    role: Option<String>,
    active: Option<bool>,
    page: Option<i64>,
    db: State<Database>,
    session: State<Session>,
) -> Result<Value, String> {
    current(&session, "workers.view")?;
    let c = db.connect()?;
    let term = format!("%{}%", search.unwrap_or_default());
    let mut q=c.prepare("SELECT id,full_name,username,coalesce(email,''),coalesce(phone,''),role,is_active,must_change_password,last_login_at,created_at FROM users WHERE (full_name LIKE ?1 OR username LIKE ?1 OR email LIKE ?1) AND (?2 IS NULL OR role=?2) AND (?3 IS NULL OR is_active=?3) ORDER BY full_name LIMIT 30 OFFSET ?4").map_err(db_err)?;
    let rows=q.query_map(params![term,role,active,(page.unwrap_or(1).max(1)-1)*30],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"fullName":r.get::<_,String>(1)?,"username":r.get::<_,String>(2)?,"email":r.get::<_,String>(3)?,"phone":r.get::<_,String>(4)?,"role":r.get::<_,String>(5)?,"isActive":r.get::<_,bool>(6)?,"mustChangePassword":r.get::<_,bool>(7)?,"lastLoginAt":r.get::<_,Option<String>>(8)?,"createdAt":r.get::<_,String>(9)?}))).map_err(db_err)?.collect::<Result<Vec<_>,_>>().map_err(db_err)?;
    Ok(json!(rows))
}
#[tauri::command]
pub fn save_worker(
    input: WorkerInput,
    db: State<Database>,
    session: State<Session>,
) -> Result<i64, String> {
    let actor = current(
        &session,
        if input.id.is_some() {
            "workers.edit"
        } else {
            "workers.create"
        },
    )?;
    if input.full_name.trim().is_empty() || input.username.trim().len() < 3 {
        return Err("Nom et identifiant obligatoires".into());
    }
    let _g = db.guard()?;
    let mut c = db.connect()?;
    let tx = c.transaction().map_err(db_err)?;
    if let Some(id) = input.id {
        let old: String = tx
            .query_row("SELECT role FROM users WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "Employé introuvable".to_string())?;
        validate_role(&actor, &input.role, Some(&old))?;
        if !input.is_active && old == "global_admin" {
            let n:i64=tx.query_row("SELECT count(*) FROM users WHERE role='global_admin' AND is_active=1 AND id<>?1",[id],|r|r.get(0)).map_err(db_err)?;
            if n == 0 {
                return Err("Le dernier administrateur actif ne peut pas être désactivé".into());
            }
        }
        tx.execute("UPDATE users SET full_name=?1,username=?2,email=?3,phone=?4,role=?5,is_active=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?7",params![input.full_name.trim(),input.username.trim(),text(input.email),text(input.phone),input.role,input.is_active,id]).map_err(|_|"Nom d’utilisateur ou e-mail déjà utilisé".to_string())?;
        tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,new_values_json)VALUES(?1,'worker.updated','user',?2,?3)",params![actor.id,id,json!({"role":input.role,"active":input.is_active}).to_string()]).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(id)
    } else {
        validate_role(&actor, &input.role, None)?;
        let password = input
            .temporary_password
            .ok_or("Mot de passe temporaire obligatoire")?;
        if !strong(&password) {
            return Err("Le mot de passe est requis.".into());
        }
        let hash = hash_password(&password)?;
        tx.execute("INSERT INTO users(full_name,username,email,phone,password_hash,role,is_active,must_change_password,created_by)VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8)",params![input.full_name.trim(),input.username.trim(),text(input.email),text(input.phone),hash,input.role,input.is_active,actor.id]).map_err(|_|"Nom d’utilisateur ou e-mail déjà utilisé".to_string())?;
        let id = tx.last_insert_rowid();
        tx.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'worker.created','user',?2)",params![actor.id,id]).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(id)
    }
}
#[tauri::command]
pub fn reset_worker_password(
    id: i64,
    password: Option<String>,
    db: State<Database>,
    session: State<Session>,
) -> Result<String, String> {
    let actor = current(&session, "workers.reset_password")?;
    let c = db.connect()?;
    let role: String = c
        .query_row("SELECT role FROM users WHERE id=?1", [id], |r| r.get(0))
        .map_err(|_| "Employé introuvable".to_string())?;
    validate_role(&actor, &role, Some(&role))?;
    let temporary = password.unwrap_or_else(|| {
        let mut b = [0u8; 8];
        OsRng.fill_bytes(&mut b);
        format!("Mkt{}aA9", u64::from_le_bytes(b))
    });
    if !strong(&temporary) {
        return Err("Le mot de passe est requis.".into());
    }
    c.execute("UPDATE users SET password_hash=?1,must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![hash_password(&temporary)?,id]).map_err(db_err)?;
    c.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'worker.password_reset','user',?2)",params![actor.id,id]).map_err(db_err)?;
    Ok(temporary)
}
#[tauri::command]
pub fn change_current_password(
    current_password: String,
    new_password: String,
    db: State<Database>,
    session: State<Session>,
) -> Result<SafeUser, String> {
    if !strong(&new_password) {
        return Err("Le mot de passe est requis.".into());
    }
    let mut guard = session
        .0
        .lock()
        .map_err(|_| "Session indisponible".to_string())?;
    let old = guard.clone().ok_or("Veuillez vous connecter")?;
    let c = db.connect()?;
    let hash: String = c
        .query_row(
            "SELECT password_hash FROM users WHERE id=?1",
            [old.id],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    if !verify_password(&current_password, &hash) {
        return Err("Mot de passe actuel incorrect".into());
    }
    if verify_password(&new_password, &hash) {
        return Err("Le nouveau mot de passe doit être différent".into());
    }
    c.execute("UPDATE users SET password_hash=?1,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![hash_password(&new_password)?,old.id]).map_err(db_err)?;
    c.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id)VALUES(?1,'password.changed','user',?1)",[old.id]).map_err(db_err)?;
    let updated = SafeUser {
        must_change_password: false,
        permissions: role_permissions(&old.role),
        ..old
    };
    *guard = Some(updated.clone());
    Ok(updated)
}
