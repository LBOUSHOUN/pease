import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import type {
  AppSettings,
  AuditEntry,
  AuditListResponse,
  BackupMetadata,
  Employee,
  EmployeeListResponse,
  ProductDetail,
  ReportResponse,
  SafeUser,
} from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad } from "./money";

const has = (u: SafeUser, p: string) => u.permissions.includes(p),
  errorText = (x: unknown) =>
    x instanceof Error ? x.message : "Une erreur est survenue.";
const ErrorBox = ({ value }: { value: string }) =>
  value ? <div className="error">{value}</div> : null;
function useDebounce(value: string) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), 300);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

export function EmployeesPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [role, setRole] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [data, setData] = useState<EmployeeListResponse>(),
    [error, setError] = useState("");
  const q = useDebounce(search);
  useEffect(() => {
    const c = new AbortController(),
      params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (q.trim()) params.set("search", q.trim());
    if (role) params.set("role", role);
    if (status !== "all") params.set("status", status);
    request<EmployeeListResponse>(
      `/users?${params}`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      });
    return () => c.abort();
  }, [q, role, status, page]);
  return (
    <main className="page">
      <div className="title">
        <h1>Employés</h1>
        {has(user, "users.create") && (
          <Link className="button" to="/employees/new">
            Nouvel employé
          </Link>
        )}
      </div>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom, identifiant ou e-mail"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous les rôles</option>
          <option value="manager">Manager</option>
          <option value="cashier">Caissier</option>
          <option value="stock_worker">Responsable stock</option>
          <option value="global_admin">Administrateur global</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Tous</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
      </div>
      {!data && !error ? <div className="loading-state">Chargement des employés…</div> : data?.rows.length === 0 ? (
        <div className="empty-state">Aucun employé ne correspond aux filtres sélectionnés.</div>
      ) : (
        <div className="table"><table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Identifiant</th>
              <th>Rôle</th>
              <th>État</th>
              <th>Dernière connexion</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link to={`/employees/${x.id}`}>{x.displayName}</Link>
                </td>
                <td>{x.username}</td>
                <td>{x.role}</td>
                <td><span className={`badge ${x.isActive ? "ok" : "off"}`}>{x.isActive ? "Actif" : "Inactif"}</span></td>
                <td>
                  {x.lastLoginAt
                    ? new Date(x.lastLoginAt).toLocaleString("fr-MA")
                    : "Jamais"}
                </td>
                <td><Link to={`/employees/${x.id}`}>Consulter</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {data && data.totalPages > 1 && <div className="pager"><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button><span>Page {page} sur {data.totalPages}</span><button className="secondary" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Suivant</button></div>}
    </main>
  );
}

export function EmployeeForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [value, setValue] = useState<Employee>(),
    [error, setError] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    if (edit)
      request<Employee>(`/users/${id}`)
        .then(setValue)
        .catch((e) => setError(errorText(e)));
  }, [edit, id]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const f = new FormData(e.currentTarget),
      json = {
        displayName: f.get("name"),
        username: f.get("username"),
        email: f.get("email") || null,
        role: f.get("role"),
        ...(!edit ? { password: f.get("password") } : {}),
      };
    try {
      if (edit) {
        await request(`/users/${id}`, { method: "PATCH", json });
        nav(`/employees/${id}`);
      } else {
        await request<{ user: Employee }>("/users", { method: "POST", json });
        nav("/employees");
      }
    } catch (x) {
      setError(errorText(x));
    } finally {
      busy.current = false;
    }
  };
  if (edit && !value)
    return (
      <main className="page">
        <ErrorBox value={error} />
      </main>
    );
  return (
    <main className="page narrow">
      <h1>{edit ? "Modifier l’employé" : "Nouvel employé"}</h1>
      <ErrorBox value={error} />
      <form onSubmit={submit}>
        <input
          name="name"
          defaultValue={value?.displayName}
          placeholder="Nom affiché"
          required
        />
        <input
          name="username"
          defaultValue={value?.username}
          placeholder="Identifiant"
          required
        />
        <input
          name="email"
          type="email"
          defaultValue={value?.email ?? ""}
          placeholder="E-mail"
        />
        <select name="role" defaultValue={value?.role ?? "cashier"}>
          <option value="manager">Manager</option>
          <option value="cashier">Caissier</option>
          <option value="stock_worker">Responsable stock</option>
          <option value="global_admin">Administrateur global</option>
        </select>
        {!edit && <label>Mot de passe<input name="password" type="password" required /></label>}
        {value?.role === "global_admin" && (
          <div className="notice">
            Le dernier administrateur global actif est protégé.
          </div>
        )}
        <button>Enregistrer</button>
      </form>
    </main>
  );
}

export function EmployeeDetails({ user }: { user: SafeUser }) {
  const { id } = useParams(),
    [value, setValue] = useState<Employee>(),
    [error, setError] = useState("");
  useEffect(() => {
    request<Employee>(`/users/${id}`)
      .then(setValue)
      .catch((e) => setError(errorText(e)));
  }, [id]);
  const toggle = async () => {
    if (
      !value ||
      !confirm(`${value.isActive ? "Désactiver" : "Activer"} cet employé ?`)
    )
      return;
    try {
      setValue(
        await request<Employee>(
          `/users/${id}/${value.isActive ? "deactivate" : "activate"}`,
          { method: "POST" },
        ),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  const force = async () => {
    if (!value || !confirm("Exiger un changement de mot de passe ?")) return;
    try {
      setValue(
        await request<Employee>(`/users/${id}/force-password-change`, {
          method: "POST",
          json: { required: true },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <main className="page">
      <ErrorBox value={error} />
      {value && (
        <>
          <div className="title">
            <h1>{value.displayName}</h1>
            <div>
              {has(user, "users.edit") && (
                <Link to={`/employees/${id}/edit`}>Modifier</Link>
              )}{" "}
              {has(user, "users.reset_password") && (
                <Link to={`/employees/${id}/reset-password`}>
                  Réinitialiser
                </Link>
              )}
            </div>
          </div>
          <dl className="details">
            <dt>Identifiant</dt>
            <dd>{value.username}</dd>
            <dt>E-mail</dt>
            <dd>{value.email || "—"}</dd>
            <dt>Rôle</dt>
            <dd>{value.role}</dd>
            <dt>État</dt>
            <dd>{value.isActive ? "Actif" : "Inactif"}</dd>
            <dt>Changement obligatoire</dt>
            <dd>{value.mustChangePassword ? "Oui" : "Non"}</dd>
          </dl>
          {(has(user, "users.activate") || has(user, "users.deactivate")) && (
            <button onClick={toggle}>
              {value.isActive ? "Désactiver" : "Activer"}
            </button>
          )}{" "}
          {has(user, "users.reset_password") && (
            <button onClick={force}>Forcer le changement</button>
          )}
        </>
      )}
    </main>
  );
}

export function PasswordReset() {
  const { id } = useParams(),
    [password, setPassword] = useState(""),
    [done, setDone] = useState(false),
    [error, setError] = useState(""),
    busy = useRef(false);
  const reset = async () => {
    if (
      busy.current ||
      !confirm(
        "Réinitialiser le mot de passe et révoquer toutes les sessions ?",
      )
    )
      return;
    busy.current = true;
    try {
      await request<{ ok: true }>(
        `/users/${id}/reset-password`,
        { method: "POST", json: { confirmation: true, password } },
      );
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      busy.current = false;
    }
  };
  return (
    <main className="page narrow">
      <h1>Réinitialisation du mot de passe</h1>
      <ErrorBox value={error} />
      {done ? (
        <>
          <div className="notice">Mot de passe réinitialisé. Les anciennes sessions ont été révoquées.</div>
          <Link className="button" to={`/employees/${id}`}>
            Terminer
          </Link>
        </>
      ) : (
        <>
          <p>
            Les sessions actives seront immédiatement révoquées et le changement
            sera obligatoire à la prochaine connexion.
          </p>
          <label>Nouveau mot de passe<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button onClick={reset} disabled={!password.trim()}>Confirmer la réinitialisation</button>
        </>
      )}
    </main>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState(""),
    [action, setAction] = useState(""),
    [entity, setEntity] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [data, setData] = useState<AuditListResponse>(),
    [selected, setSelected] = useState<AuditEntry>(),
    [error, setError] = useState("");
  const q = useDebounce(search);
  useEffect(() => {
    const c = new AbortController(),
      params = new URLSearchParams({ pageSize: "50" });
    if (q.trim()) params.set("search", q.trim());
    if (action.trim()) params.set("action", action.trim());
    if (entity.trim()) params.set("entityType", entity.trim());
    if (start) params.set("startDate", start);
    if (end) params.set("endDate", end);
    request<AuditListResponse>(`/audit-logs?${params}`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      });
    return () => c.abort();
  }, [q, action, entity, start, end]);
  return (
    <main className="page">
      <h1>Journal d’audit</h1>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher"
        />
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action"
        />
        <input
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          placeholder="Entité"
        />
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {!data && !error ? <div className="loading-state">Chargement du journal…</div> : data?.rows.length === 0 ? (
        <div className="empty-state">Aucune activité ne correspond aux filtres sélectionnés.</div>
      ) : (
        <div className="table"><table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employé</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Identifiant</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((x) => (
              <tr key={x.id}>
                <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
                <td>{x.workerName || "Système"}</td>
                <td><span className="badge ok">{x.action}</span></td>
                <td>{x.entityType}</td>
                <td>{x.entityId ?? "—"}</td>
                <td><button className="link" onClick={() => setSelected(x)}>Consulter</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {selected && (
        <aside className="drawer">
          <button onClick={() => setSelected(undefined)}>Fermer</button>
          <h2>{selected.action}</h2>
          <pre>{JSON.stringify(selected.metadata, null, 2)}</pre>
        </aside>
      )}
    </main>
  );
}

export const reportKinds = [
  { id: "sales", label: "Ventes", description: "Analysez le chiffre d’affaires et les modes de paiement.", permission: "reports.view_sales" },
  { id: "profit", label: "Bénéfice estimé", description: "Consultez la marge brute estimée sur les ventes.", permission: "reports.view_profit" },
  { id: "stock", label: "Stock", description: "Suivez les quantités, ruptures et produits à réapprovisionner.", permission: "reports.view_stock" },
  { id: "customers", label: "Clients", description: "Suivez les achats et les soldes clients.", permission: "reports.view_customers" },
  {
    id: "suppliers",
    label: "Fournisseurs",
    description: "Consultez les achats et les dettes fournisseurs.",
    permission: "reports.view_suppliers",
  },
  { id: "expenses", label: "Dépenses", description: "Analysez les dépenses par période et catégorie.", permission: "reports.view_expenses" },
  { id: "workers", label: "Employés", description: "Comparez l’activité enregistrée par employé.", permission: "reports.view_workers" },
  { id: "registers", label: "Caisses", description: "Contrôlez les sessions et écarts de caisse.", permission: "reports.view_registers" },
];
export function ReportsHub({ user }: { user: SafeUser }) {
  return (
    <main className="page">
      <div className="page-header"><div><h1>Rapports</h1><p>Choisissez une analyse pour piloter l’activité du magasin.</p></div></div>
      <div className="report-grid">
        {reportKinds
          .filter((x) => has(user, x.permission))
          .map((x) => (
            <Link className="report-card" key={x.id} to={`/reports/${x.id}`}>
              <span className="report-icon" aria-hidden="true">↗</span>
              <h2>{x.label}</h2>
              <p>{x.description}</p>
              <span className="report-action">Ouvrir le rapport</span>
            </Link>
          ))}
      </div>
    </main>
  );
}
const human = (key: string) =>
  key.replaceAll("_", " ").replace(/cents$/, "MAD");
export function ReportPage({ kind, user }: { kind: string; user: SafeUser }) {
  const [preset, setPreset] = useState("today"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [search, setSearch] = useState(""),
    [data, setData] = useState<ReportResponse>(),
    [error, setError] = useState(""),
    q = useDebounce(search);
  useEffect(() => {
    if (preset === "custom" && (!start || !end || start > end)) {
      setError("Choisissez une période valide.");
      return;
    }
    const c = new AbortController(),
      params = new URLSearchParams({ preset, pageSize: "50" });
    if (preset === "custom" && start) params.set("startDate", start);
    if (preset === "custom" && end) params.set("endDate", end);
    if (q.trim()) params.set("search", q.trim());
    request<ReportResponse>(`/reports/${kind}?${params}`, { signal: c.signal })
      .then((x) => {
        setData(x);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      });
    return () => c.abort();
  }, [kind, preset, start, end, q]);
  const exportCsv = () => {
    const params = new URLSearchParams({ preset });
    if (preset === "custom" && start) params.set("startDate", start);
    if (preset === "custom" && end) params.set("endDate", end);
    if (q.trim()) params.set("search", q.trim());
    window.location.assign(`/api/exports/${kind}.csv?${params}`);
  };
  const label = reportKinds.find((x) => x.id === kind)?.label ?? kind,
    headers = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  return (
    <main className="page print-sheet">
      <div className="title">
        <h1>{label}</h1>
        <div>
          {has(user, "exports.create") && (
            <button onClick={exportCsv}>Exporter CSV</button>
          )}{" "}
          <button onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      {kind === "profit" && (
        <div className="notice">
          Estimation de marge brute, pas un bénéfice comptable audité.
        </div>
      )}
      <ErrorBox value={error} />
      <div className="filters">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="today">Aujourd’hui</option>
          <option value="yesterday">Hier</option>
          <option value="this_week">Cette semaine</option>
          <option value="this_month">Ce mois</option>
          <option value="last_month">Mois dernier</option>
          <option value="custom">Personnalisée</option>
        </select>
        {preset === "custom" && (
          <>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher"
        />
      </div>
      <div className="metrics">
        {data &&
          Object.entries(data.summary).map(([k, v]) => (
            <div className="card" key={k}>
              <small>{human(k)}</small>
              <b>{k.includes("cents") ? centsToMad(v) : v}</b>
            </div>
          ))}
      </div>
      {data?.rows.length === 0 ? (
        <p>Aucune donnée pour cette période.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{human(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, i) => (
                <tr key={i}>
                  {headers.map((h) => (
                    <td key={h}>
                      {h.includes("cents")
                        ? centsToMad(Number(row[h]))
                        : String(row[h] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export function SettingsPage({ user }: { user: SafeUser }) {
  const [value, setValue] = useState<AppSettings>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    request<AppSettings>("/settings")
      .then(setValue)
      .catch((e) => setError(errorText(e)));
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!value || busy.current) return;
    busy.current = true;
    try {
      const payload = { ...value };
      Reflect.deleteProperty(payload, "backupRetention");
      await request("/settings", { method: "PATCH", json: payload });
      setNotice(
        "Paramètres enregistrés. Les identifiants existants restent inchangés.",
      );
    } catch (x) {
      setError(errorText(x));
    } finally {
      busy.current = false;
    }
  };
  if (!value)
    return (
      <main className="page">
        <ErrorBox value={error} />
      </main>
    );
  const set = <K extends keyof AppSettings>(key: K, v: AppSettings[K]) =>
    setValue({ ...value, [key]: v });
  return (
    <main className="page narrow">
      <h1>Paramètres</h1>
      <ErrorBox value={error} />
      {notice && <div className="notice">{notice}</div>}
      <form onSubmit={submit}>
        <input
          value={value.shopName}
          onChange={(e) => set("shopName", e.target.value)}
          placeholder="Nom du magasin"
        />
        <input
          value={value.phone ?? ""}
          onChange={(e) => set("phone", e.target.value || null)}
          placeholder="Téléphone"
        />
        <textarea
          value={value.address ?? ""}
          onChange={(e) => set("address", e.target.value || null)}
          placeholder="Adresse"
        />
        <input
          value={value.timezone}
          onChange={(e) => set("timezone", e.target.value)}
          placeholder="Fuseau horaire"
        />
        <input
          value={value.barcodePrefix}
          onChange={(e) => set("barcodePrefix", e.target.value.toUpperCase())}
          placeholder="Préfixe futurs codes"
        />
        <select
          value={value.receiptWidth}
          onChange={(e) =>
            set("receiptWidth", Number(e.target.value) as 58 | 80)
          }
        >
          <option value="58">Reçu 58 mm</option>
          <option value="80">Reçu 80 mm</option>
        </select>
        <textarea
          value={value.receiptFooter ?? ""}
          onChange={(e) => set("receiptFooter", e.target.value || null)}
          placeholder="Pied du reçu"
        />
        <select
          value={value.labelSize}
          onChange={(e) =>
            set("labelSize", e.target.value as AppSettings["labelSize"])
          }
        >
          <option value="40x30">40 × 30 mm</option>
          <option value="50x30">50 × 30 mm</option>
          <option value="A4">A4</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={value.showBarcodeOnReceipt}
            onChange={(e) => set("showBarcodeOnReceipt", e.target.checked)}
          />{" "}
          Code-barres sur reçu
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.showQrOnLabel}
            onChange={(e) => set("showQrOnLabel", e.target.checked)}
          />{" "}
          QR sur étiquette
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.showPriceOnLabel}
            onChange={(e) => set("showPriceOnLabel", e.target.checked)}
          />{" "}
          Prix sur étiquette
        </label>
        <button disabled={!has(user, "settings.manage")}>Enregistrer</button>
      </form>
    </main>
  );
}

export function BackupsPage({ user }: { user: SafeUser }) {
  const [rows, setRows] = useState<BackupMetadata[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    busy = useRef(false);
  const load = () =>
    request<{ rows: BackupMetadata[] }>("/backups")
      .then((x) => setRows(x.rows))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await request("/backups", { method: "POST" });
      setNotice("Sauvegarde créée.");
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      busy.current = false;
    }
  };
  const verify = async (id: number) => {
    try {
      await request(`/backups/${id}/verify`, { method: "POST" });
      setNotice("Checksum et archive PostgreSQL vérifiés.");
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const restore = async (id: number) => {
    if (
      !has(user, "backups.restore") ||
      !confirm(
        "Restauration destructive : une sauvegarde de sécurité sera créée. Continuer ?",
      ) ||
      prompt("Saisissez RESTORE pour confirmer") !== "RESTORE"
    )
      return;
    try {
      await request(`/backups/${id}/restore`, {
        method: "POST",
        json: { confirmation: "RESTORE" },
      });
      setNotice("Restauration terminée. Redémarrez l’API.");
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <main className="page">
      <div className="title">
        <h1>Sauvegardes PostgreSQL</h1>
        <button onClick={create}>Créer</button>
      </div>
      <ErrorBox value={error} />
      {notice && <div className="notice">{notice}</div>}
      <div className="notice">
        La conservation des sauvegardes est configurée dans le service de sauvegarde.
      </div>
      <table>
        <thead>
          <tr>
            <th>Fichier</th>
            <th>Date</th>
            <th>Taille</th>
            <th>État</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>{x.filename}</td>
              <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
              <td>{Math.ceil(x.sizeBytes / 1024)} Ko</td>
              <td>{x.status}</td>
              <td>
                <button onClick={() => verify(x.id)}>Vérifier</button>
                {has(user, "backups.restore") && (
                  <button onClick={() => restore(x.id)}>Restaurer</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function isValidEan13(code: string) {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const sum = digits.slice(0, 12).reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === digits[12];
}

export const labelBarcodeFormat = (code: string): "EAN13" | "CODE128" =>
  isValidEan13(code) ? "EAN13" : "CODE128";

export function LabelBarcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, code, {
        format: labelBarcodeFormat(code),
        displayValue: true,
        text: code,
        width: 2,
        height: 42,
        margin: 8,
        lineColor: "#000000",
        background: "#ffffff",
      });
      setError(false);
    } catch {
      ref.current.replaceChildren();
      setError(true);
    }
  }, [code]);
  return error ? (
    <span className="label-barcode-error" role="alert">Le code-barres ne peut pas être généré.</span>
  ) : <svg ref={ref} className="label-linear-barcode" role="img" aria-label={`Code-barres ${code}`} />;
}
export function ProductLabel() {
  const { id } = useParams(),
    [product, setProduct] = useState<ProductDetail>(),
    [settings, setSettings] = useState<AppSettings>(),
    [quantity, setQuantity] = useState(1),
    [format, setFormat] = useState<"thermal" | "a4">(() =>
      window.localStorage.getItem("maktaba-label-format") === "a4" ? "a4" : "thermal",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      request<ProductDetail>(`/products/${id}`),
      request<AppSettings>("/settings"),
    ])
      .then(([p, s]) => {
        setProduct(p);
        setSettings(s);
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);
  return (
    <main className="page labels-page">
      <div className="title">
        <h1>Étiquette produit</h1>
        <div className="inline-actions">
          <select value={format} onChange={(e) => {
            const next = e.target.value as "thermal" | "a4";
            setFormat(next);
            window.localStorage.setItem("maktaba-label-format", next);
          }} aria-label="Format d'impression">
            <option value="thermal">Étiquette thermique individuelle</option>
            <option value="a4">Planche d'étiquettes A4</option>
          </select>
          <select value={[1, 6, 12, 24].includes(quantity) ? String(quantity) : "custom"} onChange={(e) => {
            if (e.target.value !== "custom") setQuantity(Number(e.target.value));
          }} aria-label="Quantité d'étiquettes">
            {[1, 6, 12, 24].map((value) => <option key={value} value={value}>{value}</option>)}
            <option value="custom">Personnalisée</option>
          </select>
          <input
            type="number"
            min="1"
            max="100"
            value={quantity}
            onChange={(e) =>
              setQuantity(Math.max(1, Math.min(100, Number(e.target.value))))
            }
          />
          <button onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      <ErrorBox value={error} />
      {product && settings && (
        <div className={`labels label-format-${format} size-${settings.labelSize.replace("x", "-")}`}>
          {Array.from({ length: quantity }, (_, i) => (
            <article className="product-label" key={i}>
              <strong>{settings.shopName || "Double Library"}</strong>
              <span>{product.name}</span>
              <LabelBarcode code={product.manufacturerBarcode || product.internalBarcode} />
              <code className="label-barcode-value">{product.manufacturerBarcode || product.internalBarcode}</code>
              <b>{centsToMad(product.sellingPriceCents)}</b>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
