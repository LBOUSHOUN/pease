import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
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
    [data, setData] = useState<EmployeeListResponse>(),
    [error, setError] = useState("");
  const q = useDebounce(search);
  useEffect(() => {
    const c = new AbortController();
    request<EmployeeListResponse>(
      `/users?search=${encodeURIComponent(q)}&role=${role}&status=${status}&pageSize=50`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(errorText(e));
      });
    return () => c.abort();
  }, [q, role, status]);
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
      {data?.rows.length === 0 ? (
        <p>Aucun employé.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Identifiant</th>
              <th>Rôle</th>
              <th>État</th>
              <th>Dernière connexion</th>
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
                <td>{x.isActive ? "Actif" : "Inactif"}</td>
                <td>
                  {x.lastLoginAt
                    ? new Date(x.lastLoginAt).toLocaleString("fr-MA")
                    : "Jamais"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export function EmployeeForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [value, setValue] = useState<Employee>(),
    [error, setError] = useState(""),
    [temporary, setTemporary] = useState(""),
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
      };
    try {
      if (edit) {
        await request(`/users/${id}`, { method: "PATCH", json });
        nav(`/employees/${id}`);
      } else {
        const r = await request<{ user: Employee; temporaryPassword: string }>(
          "/users",
          { method: "POST", json },
        );
        setTemporary(r.temporaryPassword);
      }
    } catch (x) {
      setError(errorText(x));
    } finally {
      busy.current = false;
    }
  };
  if (temporary)
    return (
      <main className="page narrow">
        <h1>Employé créé</h1>
        <div className="notice">
          Mot de passe temporaire affiché une seule fois :
        </div>
        <code className="temporary-password">{temporary}</code>
        <p>L’employé devra le changer à sa première connexion.</p>
        <button onClick={() => nav("/employees")}>Terminer</button>
      </main>
    );
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
    [temporary, setTemporary] = useState(""),
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
      const r = await request<{ temporaryPassword: string }>(
        `/users/${id}/reset-password`,
        { method: "POST", json: { confirmation: true } },
      );
      setTemporary(r.temporaryPassword);
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
      {temporary ? (
        <>
          <div className="notice">
            Copiez maintenant ce mot de passe temporaire. Il disparaîtra en
            quittant cette page.
          </div>
          <code className="temporary-password">{temporary}</code>
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
          <button onClick={reset}>Confirmer la réinitialisation</button>
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
      params = new URLSearchParams({
        search: q,
        action,
        entityType: entity,
        startDate: start,
        endDate: end,
        pageSize: "50",
      });
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
      {data?.rows.length === 0 ? (
        <p>Aucun événement.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employé</th>
              <th>Action</th>
              <th>Entité</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((x) => (
              <tr key={x.id} onClick={() => setSelected(x)}>
                <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
                <td>{x.workerName || "Système"}</td>
                <td>{x.action}</td>
                <td>
                  {x.entityType} {x.entityId ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  { id: "sales", label: "Ventes", permission: "reports.view_sales" },
  { id: "profit", label: "Bénéfice estimé", permission: "reports.view_profit" },
  { id: "stock", label: "Stock", permission: "reports.view_stock" },
  { id: "customers", label: "Clients", permission: "reports.view_customers" },
  {
    id: "suppliers",
    label: "Fournisseurs",
    permission: "reports.view_suppliers",
  },
  { id: "expenses", label: "Dépenses", permission: "reports.view_expenses" },
  { id: "workers", label: "Employés", permission: "reports.view_workers" },
  { id: "registers", label: "Caisses", permission: "reports.view_registers" },
];
export function ReportsHub({ user }: { user: SafeUser }) {
  return (
    <main className="page">
      <h1>Rapports</h1>
      <div className="cards">
        {reportKinds
          .filter((x) => has(user, x.permission))
          .map((x) => (
            <Link className="card" key={x.id} to={`/reports/${x.id}`}>
              <h2>{x.label}</h2>
              <p>Données PostgreSQL paginées et export sécurisé.</p>
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
      params = new URLSearchParams({
        preset,
        startDate: start,
        endDate: end,
        search: q,
        pageSize: "50",
      });
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
    const params = new URLSearchParams({
      preset,
      startDate: start,
      endDate: end,
      search: q,
    });
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
      await request("/settings", { method: "PATCH", json: value });
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
        <input
          type="number"
          min="1"
          max="365"
          value={value.backupRetention}
          onChange={(e) => set("backupRetention", Number(e.target.value))}
        />
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

function LabelBarcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current)
      JsBarcode(ref.current, code, {
        format: "CODE128",
        displayValue: true,
        height: 45,
        margin: 2,
      });
  }, [code]);
  return <svg ref={ref} />;
}
export function ProductLabel() {
  const { id } = useParams(),
    [product, setProduct] = useState<ProductDetail>(),
    [settings, setSettings] = useState<AppSettings>(),
    [quantity, setQuantity] = useState(1),
    [qr, setQr] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      request<ProductDetail>(`/products/${id}`),
      request<AppSettings>("/settings"),
    ])
      .then(([p, s]) => {
        setProduct(p);
        setSettings(s);
        QRCode.toDataURL(p.qrIdentifier, { width: 180, margin: 1 }).then(setQr);
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);
  return (
    <main className="page labels-page">
      <div className="title">
        <h1>Étiquette produit</h1>
        <div>
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
        <div className={`labels size-${settings.labelSize.replace("x", "-")}`}>
          {Array.from({ length: quantity }, (_, i) => (
            <article className="product-label" key={i}>
              <strong>{settings.shopName}</strong>
              <span>{product.name}</span>
              <LabelBarcode code={product.internalBarcode} />
              {settings.showQrOnLabel && qr && (
                <img src={qr} alt={`QR ${product.qrIdentifier}`} />
              )}{" "}
              {settings.showPriceOnLabel && (
                <b>{centsToMad(product.sellingPriceCents)}</b>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
