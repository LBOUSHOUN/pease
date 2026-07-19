import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Customer,
  CustomerCreditListResponse,
  CustomerListResponse,
  ProductListResponse,
  ProductListRow,
  ProductLookup,
  RegisterMovementListResponse,
  RegisterSession,
  RegisterSessionListResponse,
  RegisterStatus,
  SafeUser,
  SaleDetail,
  SaleListResponse,
  SaleResult,
} from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad, madToCents } from "./money";
import { useScanner } from "./use-scanner";
import CameraScanner from "./CameraScanner";
import {
  addCartProduct,
  CartLine,
  DENOMINATIONS,
  denominationTotal,
  estimatedCartTotal,
  estimatedCredit,
  remainingDebt,
} from "./phase3-utils";
import {
  checkConnection,
  findCachedProductByCode,
  getCachedProducts,
  getOfflineCacheStatus,
  getOfflineQueueSummary,
  estimatedStock,
  queueOfflineSale,
  refreshOfflineCache,
  syncPendingOfflineSales,
  readQueueAsync,
  isTauriRuntime,
} from "./offline-pos";
import type { OfflineCacheStatus, OfflineQueueSummary, OfflineSaleRecord } from "./offline-pos";

const has = (user: SafeUser, permission: string) =>
  user.permissions.includes(permission);
const ErrorBox = ({ value }: { value: string }) =>
  value ? <div className="error">{value}</div> : null;
const Notice = ({ value }: { value: string }) =>
  value ? <div className="notice">{value}</div> : null;
const useDebounced = (value: string) => {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
};
const lines = (counts: Record<number, number>) =>
  DENOMINATIONS.map((denominationCents) => ({
    denominationCents,
    quantity: Math.max(0, Math.floor(counts[denominationCents] ?? 0)),
  }));

function Denominations({
  counts,
  setCounts,
}: {
  counts: Record<number, number>;
  setCounts: (value: Record<number, number>) => void;
}) {
  return (
    <div className="denominations">
      {DENOMINATIONS.map((value) => (
        <label key={value}>
          {centsToMad(value)}
          <input
            type="number"
            min="0"
            value={counts[value] ?? 0}
            onChange={(event) =>
              setCounts({ ...counts, [value]: Number(event.target.value) })
            }
          />
        </label>
      ))}
      <strong>Total : {centsToMad(denominationTotal(counts))}</strong>
    </div>
  );
}

export function RegisterPage({ user }: { user: SafeUser }) {
  const [status, setStatus] = useState<RegisterStatus>(),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    request<RegisterStatus>("/register/status", { signal: controller.signal })
      .then(setStatus)
      .catch(
        (reason) => reason.name !== "AbortError" && setError(reason.message),
      );
    return () => controller.abort();
  }, []);
  return (
    <main className="page">
      <div className="title">
        <h1>Caisse</h1>
        <div>
          <Link className="button secondary" to="/register/sessions">
            Sessions
          </Link>{" "}
          <Link className="button secondary" to="/register/movements">
            Mouvements
          </Link>
        </div>
      </div>
      <ErrorBox value={error} />
      {!status ? (
        <p>Chargement…</p>
      ) : status.isOpen ? (
        <section className="card">
          <h2>Caisse ouverte</h2>
          <p>Ouverte le {new Date(status.openedAt!).toLocaleString("fr-MA")}</p>
          <p>
            Fond : <b>{centsToMad(status.openingCashCents)}</b>
          </p>
          <p>
            Ventes comptant : <b>{centsToMad(status.summary.cashSalesCents)}</b>
          </p>
          <p>
            Règlements clients :{" "}
            <b>{centsToMad(status.summary.debtPaymentsCents)}</b>
          </p>
          <p>
            Espèces attendues : <b>{centsToMad(status.expectedCashCents)}</b>
          </p>
          {has(user, "register.close") && (
            <Link className="button" to="/register/close">
              Clôturer
            </Link>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Aucune caisse ouverte</h2>
          {has(user, "register.open") && (
            <Link className="button" to="/register/open">
              Ouvrir une caisse
            </Link>
          )}
        </section>
      )}
    </main>
  );
}

export function RegisterOpen() {
  const [amount, setAmount] = useState("0"),
    [counts, setCounts] = useState<Record<number, number>>({}),
    [useCounts, setUseCounts] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    nav = useNavigate(),
    lock = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current) return;
    try {
      lock.current = true;
      setBusy(true);
      const opening = useCounts
        ? denominationTotal(counts)
        : madToCents(amount);
      await request("/register/open", {
        method: "POST",
        json: {
          openingCashCents: opening,
          denominations: useCounts ? lines(counts) : undefined,
          note: String(new FormData(event.currentTarget).get("note") ?? ""),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      nav("/register");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erreur");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>Ouverture de caisse</h1>
      <ErrorBox value={error} />
      <form onSubmit={submit}>
        <label>
          Fond de caisse MAD
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={useCounts}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={useCounts}
            onChange={(e) => setUseCounts(e.target.checked)}
          />{" "}
          Utiliser les coupures
        </label>
        {useCounts && <Denominations counts={counts} setCounts={setCounts} />}
        <label>
          Note
          <textarea name="note" />
        </label>
        <button disabled={busy}>
          {busy ? "Ouverture…" : "Confirmer l’ouverture"}
        </button>
      </form>
    </main>
  );
}

export function RegisterClose() {
  const [status, setStatus] = useState<RegisterStatus>(),
    [counts, setCounts] = useState<Record<number, number>>({}),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    nav = useNavigate(),
    actual = denominationTotal(counts),
    difference = actual - (status?.expectedCashCents ?? 0),
    lock = useRef(false);
  useEffect(() => {
    request<RegisterStatus>("/register/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (lock.current || !status?.isOpen) return;
    if (difference !== 0 && !reason.trim())
      return setError("Un motif est obligatoire en cas d’écart.");
    if (!confirm(`Clôturer avec un écart de ${centsToMad(difference)} ?`))
      return;
    try {
      lock.current = true;
      setBusy(true);
      await request("/register/close", {
        method: "POST",
        json: {
          actualCashCents: actual,
          denominations: lines(counts),
          differenceReason: reason,
          note: String(new FormData(e.currentTarget).get("note") ?? ""),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      nav(`/register/sessions/${status.sessionId}`);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>Clôture de caisse</h1>
      <ErrorBox value={error} />
      {!status ? (
        <p>Chargement…</p>
      ) : !status.isOpen ? (
        <p>Aucune caisse ouverte.</p>
      ) : (
        <form onSubmit={submit}>
          <p>
            Attendu : <b>{centsToMad(status.expectedCashCents)}</b>
          </p>
          <Denominations counts={counts} setCounts={setCounts} />
          <p className={difference ? "error" : "notice"}>
            Écart : {centsToMad(difference)}
          </p>
          {difference !== 0 && (
            <label>
              Motif de l’écart
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            Note
            <textarea name="note" />
          </label>
          <button disabled={busy}>{busy ? "Clôture…" : "Clôturer"}</button>
        </form>
      )}
    </main>
  );
}

export function RegisterSessions() {
  const [data, setData] = useState<RegisterSessionListResponse>(),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    request<RegisterSessionListResponse>(`/register/sessions?page=${page}`, {
      signal: c.signal,
    })
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => c.abort();
  }, [page]);
  return (
    <main className="page">
      <h1>Sessions de caisse</h1>
      <ErrorBox value={error} />
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucune session.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Caissier</th>
                <th>Ouverture</th>
                <th>Fond</th>
                <th>État</th>
                <th>Écart</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.cashierName}</td>
                  <td>{new Date(x.openedAt).toLocaleString("fr-MA")}</td>
                  <td>{centsToMad(x.openingCashCents)}</td>
                  <td>{x.status}</td>
                  <td>
                    {x.differenceCents === null
                      ? "—"
                      : centsToMad(x.differenceCents)}
                  </td>
                  <td>
                    <Link to={`/register/sessions/${x.id}`}>Voir</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}
export function RegisterSessionDetails() {
  const { id } = useParams(),
    [data, setData] = useState<RegisterSession>(),
    [error, setError] = useState("");
  useEffect(() => {
    request<RegisterSession>(`/register/sessions/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="page print-sheet">
      <ErrorBox value={error} />
      {data && (
        <>
          <div className="title">
            <h1>Clôture caisse #{data.id}</h1>
            <button onClick={() => window.print()}>Imprimer</button>
          </div>
          <dl className="details">
            <dt>Caissier</dt>
            <dd>{data.cashierName}</dd>
            <dt>Ouverture</dt>
            <dd>{new Date(data.openedAt).toLocaleString("fr-MA")}</dd>
            <dt>Fond</dt>
            <dd>{centsToMad(data.openingCashCents)}</dd>
            <dt>Ventes espèces</dt>
            <dd>{centsToMad(data.summary?.cashSalesCents ?? 0)}</dd>
            <dt>Règlements clients</dt>
            <dd>{centsToMad(data.summary?.debtPaymentsCents ?? 0)}</dd>
            <dt>Attendu</dt>
            <dd>
              {data.expectedCashCents === null
                ? "—"
                : centsToMad(data.expectedCashCents)}
            </dd>
            <dt>Réel</dt>
            <dd>
              {data.actualCashCents === null
                ? "—"
                : centsToMad(data.actualCashCents)}
            </dd>
            <dt>Écart</dt>
            <dd>
              {data.differenceCents === null
                ? "—"
                : centsToMad(data.differenceCents)}
            </dd>
            <dt>Motif</dt>
            <dd>{data.differenceReason || "—"}</dd>
          </dl>
          <h2>Coupures</h2>
          {data.denominations
            ?.filter(
              (x) => (x as typeof x & { phase?: string }).phase === "closing",
            )
            .map((x) => (
              <p key={x.denominationCents}>
                {centsToMad(x.denominationCents)} × {x.quantity} ={" "}
                {centsToMad(x.totalCents ?? 0)}
              </p>
            ))}
        </>
      )}
    </main>
  );
}
export function RegisterMovements() {
  const [data, setData] = useState<RegisterMovementListResponse>(),
    [page, setPage] = useState(1);
  useEffect(() => {
    const c = new AbortController();
    request<RegisterMovementListResponse>(`/register/movements?page=${page}`, {
      signal: c.signal,
    }).then(setData);
    return () => c.abort();
  }, [page]);
  return (
    <main className="page">
      <h1>Mouvements de caisse</h1>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucun mouvement.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Montant</th>
                <th>Référence</th>
                <th>Employé</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
                  <td>{x.movementType}</td>
                  <td>
                    {x.direction === "out" ? "−" : "+"}
                    {centsToMad(x.amountCents)}
                  </td>
                  <td>
                    {x.referenceType
                      ? `${x.referenceType} #${x.referenceId}`
                      : "—"}
                  </td>
                  <td>{x.workerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}

export function CustomersPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [debt, setDebt] = useState(false),
    [page, setPage] = useState(1),
    [data, setData] = useState<CustomerListResponse>(),
    [error, setError] = useState(""),
    query = useDebounced(search);
  useEffect(() => {
    const c = new AbortController(),
      p = new URLSearchParams({
        search: query,
        status,
        debtOnly: String(debt),
        page: String(page),
      });
    request<CustomerListResponse>(`/customers?${p}`, { signal: c.signal })
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => c.abort();
  }, [query, status, debt, page]);
  return (
    <main className="page">
      <div className="title">
        <h1>Clients</h1>
        {has(user, "customers.manage") && (
          <Link className="button" to="/customers/new">
            Nouveau client
          </Link>
        )}
      </div>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Nom, téléphone ou e-mail"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Tous</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={debt}
            onChange={(e) => {
              setDebt(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Avec dette
        </label>
      </div>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucun client.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Dette</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.phone || "—"}</td>
                  <td>{centsToMad(x.currentDebtCents)}</td>
                  <td>{x.isActive ? "Actif" : "Inactif"}</td>
                  <td>
                    <Link to={`/customers/${x.id}`}>Voir</Link>
                    {has(user, "customers.manage") && (
                      <>
                        {" "}
                        · <Link to={`/customers/${x.id}/edit`}>Modifier</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}

export function CustomerForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [customer, setCustomer] = useState<Customer>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (edit)
      request<Customer>(`/customers/${id}`)
        .then(setCustomer)
        .catch((e) => setError(e.message));
  }, [edit, id]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    try {
      setBusy(true);
      const body = {
        name: String(f.get("name")),
        phone: String(f.get("phone")),
        email: String(f.get("email")),
        address: String(f.get("address")),
        notes: String(f.get("notes")),
        creditLimitCents: madToCents(String(f.get("limit") || "0")),
      };
      const saved = await request<Customer>(
        edit ? `/customers/${id}` : "/customers",
        { method: edit ? "PATCH" : "POST", json: body },
      );
      nav(`/customers/${saved.id}`);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>{edit ? "Modifier le client" : "Nouveau client"}</h1>
      <ErrorBox value={error} />
      {edit && !customer ? (
        <p>Chargement…</p>
      ) : (
        <form onSubmit={submit} key={customer?.id}>
          <label>
            Nom
            <input name="name" defaultValue={customer?.name} required />
          </label>
          <label>
            Téléphone
            <input name="phone" defaultValue={customer?.phone ?? ""} />
          </label>
          <label>
            E-mail
            <input
              name="email"
              type="email"
              defaultValue={customer?.email ?? ""}
            />
          </label>
          <label>
            Adresse
            <textarea name="address" defaultValue={customer?.address ?? ""} />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={customer?.notes ?? ""} />
          </label>
          <label>
            Limite de crédit MAD
            <input
              name="limit"
              defaultValue={
                customer ? String(customer.creditLimitCents / 100) : "0"
              }
            />
          </label>
          <button disabled={busy}>Enregistrer</button>
        </form>
      )}
    </main>
  );
}

export function CustomerDetails({ user }: { user: SafeUser }) {
  const { id } = useParams(),
    [customer, setCustomer] = useState<Customer>(),
    [ledger, setLedger] = useState<CustomerCreditListResponse>(),
    [sales, setSales] = useState<SaleListResponse>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      request<Customer>(`/customers/${id}`, { signal: c.signal }),
      has(user, "credit.view")
        ? request<CustomerCreditListResponse>(
            `/customers/${id}/credit-transactions?pageSize=10`,
            { signal: c.signal },
          )
        : Promise.resolve(undefined),
      request<SaleListResponse>(`/sales?customerId=${id}&pageSize=10`, {
        signal: c.signal,
      }),
    ])
      .then(([a, b, d]) => {
        setCustomer(a);
        setLedger(b);
        setSales(d);
      })
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => c.abort();
  }, [id, user]);
  const toggle = async () => {
    if (!customer) return;
    await request(
      `/customers/${id}/${customer.isActive ? "deactivate" : "activate"}`,
      { method: "POST" },
    );
    setCustomer({ ...customer, isActive: !customer.isActive });
  };
  return (
    <main className="page">
      <ErrorBox value={error} />
      {customer && (
        <>
          <div className="title">
            <h1>{customer.name}</h1>
            <div>
              {has(user, "credit.manage") && customer.currentDebtCents > 0 && (
                <Link className="button" to={`/customers/${id}/payment`}>
                  Encaisser
                </Link>
              )}{" "}
              {has(user, "customers.manage") && (
                <Link className="button secondary" to={`/customers/${id}/edit`}>
                  Modifier
                </Link>
              )}
            </div>
          </div>
          <dl className="details">
            <dt>Téléphone</dt>
            <dd>{customer.phone || "—"}</dd>
            <dt>E-mail</dt>
            <dd>{customer.email || "—"}</dd>
            <dt>Adresse</dt>
            <dd>{customer.address || "—"}</dd>
            <dt>Dette</dt>
            <dd>
              <b>{centsToMad(customer.currentDebtCents)}</b>
            </dd>
            <dt>Limite</dt>
            <dd>{centsToMad(customer.creditLimitCents)}</dd>
            <dt>État</dt>
            <dd>{customer.isActive ? "Actif" : "Inactif"}</dd>
          </dl>
          {has(user, "customers.manage") && (
            <button className="secondary" onClick={toggle}>
              {customer.isActive ? "Désactiver" : "Réactiver"}
            </button>
          )}
          <h2>Historique de crédit</h2>
          {!ledger?.rows.length ? (
            <p className="empty">Aucune opération.</p>
          ) : (
            ledger.rows.map((x) => (
              <p key={x.id}>
                {new Date(x.createdAt).toLocaleString("fr-MA")} ·{" "}
                {x.transactionType} · {centsToMad(x.amountCents)} · solde{" "}
                {centsToMad(x.balanceAfterCents)}
              </p>
            ))
          )}
          <h2>Ventes récentes</h2>
          {sales?.rows.map((x) => (
            <p key={x.id}>
              <Link to={`/sales/${x.id}`}>{x.saleNumber}</Link> ·{" "}
              {centsToMad(x.totalCents)}
            </p>
          ))}
        </>
      )}
    </main>
  );
}

export function CustomerPayment() {
  const { id } = useParams(),
    nav = useNavigate(),
    [customer, setCustomer] = useState<Customer>(),
    [status, setStatus] = useState<RegisterStatus>(),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false);
  useEffect(() => {
    Promise.all([
      request<Customer>(`/customers/${id}`),
      request<RegisterStatus>("/register/status"),
    ])
      .then(([a, b]) => {
        setCustomer(a);
        setStatus(b);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  let cents = 0;
  try {
    cents = amount ? madToCents(amount) : 0;
  } catch {
    cents = 0;
  }
  const remaining = remainingDebt(customer?.currentDebtCents ?? 0, cents);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (lock.current || !customer) return;
    if (remaining < 0) return setError("Le paiement dépasse la dette.");
    if (!confirm(`Encaisser ${centsToMad(cents)} ?`)) return;
    try {
      lock.current = true;
      setBusy(true);
      await request(`/customers/${id}/payments`, {
        method: "POST",
        json: {
          amountCents: cents,
          note: String(new FormData(e.currentTarget).get("note") ?? ""),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      nav(`/customers/${id}`);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="page narrow">
      <h1>Règlement client</h1>
      <ErrorBox value={error} />
      {customer && (
        <form onSubmit={submit}>
          <p>
            Dette actuelle : <b>{centsToMad(customer.currentDebtCents)}</b>
          </p>
          {status && !status.isOpen && (
            <div className="error">Une caisse ouverte est obligatoire.</div>
          )}
          <label>
            Montant MAD
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <p>
            Dette restante : <b>{centsToMad(remaining)}</b>
          </p>
          <label>
            Note
            <textarea name="note" />
          </label>
          <button
            disabled={busy || !status?.isOpen || cents <= 0 || remaining < 0}
          >
            Confirmer
          </button>
        </form>
      )}
    </main>
  );
}

export function PosPage({ user }: { user: SafeUser }) {
  const [cart, setCart] = useState<CartLine[]>([]),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ProductListRow[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [customerQuery, setCustomerQuery] = useState(""),
    [customerId, setCustomerId] = useState(""),
    [mode, setMode] = useState<"cash" | "credit" | "partial">("cash"),
    [cash, setCash] = useState(""),
    [status, setStatus] = useState<RegisterStatus>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sale, setSale] = useState<SaleResult | { id: string; saleNumber: string; totalCents: number }>(),
    [camera, setCamera] = useState(false),
    [connectionState, setConnectionState] = useState<"online" | "offline" | "checking">("checking"),
    [queueSummary, setQueueSummary] = useState<OfflineQueueSummary>({ pendingCount: 0, syncingCount: 0, syncedCount: 0, rejectedCount: 0 }),
    nav = useNavigate(),
    search = useDebounced(query),
    cq = useDebounced(customerQuery),
    total = estimatedCartTotal(cart),
    checkoutLock = useRef(false);
  const offline = connectionState === "offline";
  let cashCents = 0;
  try {
    cashCents = cash ? madToCents(cash) : 0;
  } catch {
    cashCents = 0;
  }
  const credit =
    mode === "credit"
      ? total
      : mode === "partial"
        ? estimatedCredit(total, cashCents)
        : 0;
  useEffect(() => {
    let active = true;
    const update = () => void checkConnection().then((state) => active && setConnectionState(state));
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (connectionState === "offline") {
      void getOfflineCacheStatus().then((cached) => {
        if (cached?.register) setStatus({ isOpen: cached.register.isOpen, sessionId: cached.register.sessionId } as RegisterStatus);
      });
      return;
    }
    if (connectionState !== "online") return;
    request<RegisterStatus>("/register/status")
      .then((value) => {
        setStatus(value);
        if (isTauriRuntime()) void refreshOfflineCache({ isOpen: value.isOpen, sessionId: value.sessionId });
      })
      .catch(() => undefined);
  }, [connectionState]);
  useEffect(() => {
    if (connectionState === "offline") {
      if (mode !== "cash") setMode("cash");
      void Promise.all([getCachedProducts(search, 12), readQueueAsync()])
        .then(([products, queue]) => setResults(estimatedStock(products, queue)));
      return;
    }
    if (!search) return setResults([]);
    const c = new AbortController();
    request<ProductListResponse>(
      `/products?search=${encodeURIComponent(search)}&status=active&pageSize=12`,
      { signal: c.signal },
    )
      .then((x) => setResults(x.rows))
      .catch(() => setResults([]));
    return () => c.abort();
  }, [connectionState, mode, search]);
  useEffect(() => {
    if (connectionState === "offline") return setCustomers([]);
    if (!cq) return setCustomers([]);
    const c = new AbortController();
    request<CustomerListResponse>(
      `/customers?search=${encodeURIComponent(cq)}&status=active&pageSize=12`,
      { signal: c.signal },
    ).then((x) => setCustomers(x.rows));
    return () => c.abort();
  }, [connectionState, cq]);
  useEffect(() => {
    if (connectionState !== "online") return;
    void syncPendingOfflineSales().finally(() => void getOfflineQueueSummary().then(setQueueSummary));
  }, [connectionState]);
  const add = (product: ProductListRow) => {
    if (
      product.productType === "physical_product" &&
      product.trackStock &&
      product.currentStock <= 0
    )
      return setError("Produit en rupture de stock.");
    setCart((value) => addCartProduct(value, product));
    setError("");
  };
  const scan = async (code: string) => {
    try {
      const product =
        connectionState === "offline"
          ? await findCachedProductByCode(code)
          : (
              await request<ProductLookup>(
                `/products/lookup?code=${encodeURIComponent(code)}&saleReady=true`,
              )
            ).product;
      if (!product) throw new Error("Produit introuvable");
      add(product);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Produit introuvable");
    }
  };
  useScanner((code) => void scan(code));
  const checkout = async () => {
    if (checkoutLock.current || !cart.length) return;
    if (offline && mode !== "cash")
      return setError("Le crédit et le partiel sont indisponibles hors ligne. Passez en mode comptant.");
    if ((mode === "credit" || mode === "partial") && !customerId)
      return setError("Choisissez un client pour le crédit.");
    if ((mode === "cash" || mode === "partial") && !status?.isOpen)
      return setError("Ouvrez une caisse pour la part comptant.");
    try {
      checkoutLock.current = true;
      setBusy(true);
      const idempotencyKey = crypto.randomUUID();
      const onlinePayload = {
        customerId: customerId ? Number(customerId) : null,
        items: cart.map((x) => ({
          productId: x.product.id,
          quantity: x.quantity,
        })),
        paymentMode: mode,
        cashPaidCents: mode === "partial" ? cashCents : 0,
        idempotencyKey,
      };
      if (offline) {
        if (!isTauriRuntime()) throw new Error("Les ventes hors ligne sont réservées à l’application de bureau.");
        if (!status?.sessionId) throw new Error("Une caisse ouverte observée en ligne est requise.");
        const id = await queueOfflineSale({
          schemaVersion: 1,
          customerId: null,
          items: cart.map((x) => ({ productId: x.product.id, quantity: x.quantity, cachedUnitPriceCents: x.product.sellingPriceCents })),
          paymentMode: "cash",
          cashPaidCents: 0,
          idempotencyKey,
          clientTimestamp: new Date().toISOString(),
          registerIdSnapshot: status.sessionId,
          userSnapshot: { id: user.id, fullName: user.fullName, role: user.role },
        });
        setSale({
          id,
          saleNumber: `HORS-LIGNE #${id.slice(0, 8).toUpperCase()}`,
          totalCents: total,
        });
        setCart([]);
        setCash("");
        setQueueSummary(await getOfflineQueueSummary());
        setError("");
        return;
      }
      const result = await request<SaleResult>("/sales", {
        method: "POST",
        json: onlinePayload,
      });
      setSale(result);
      setCart([]);
      setCash("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vente impossible");
    } finally {
      checkoutLock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="page">
      <div className="title">
        <h1>Point de vente</h1>
        <Link to="/sales">Historique</Link>
      </div>
      <ErrorBox value={error} />
      {offline && (
        <Notice
          value={`Mode hors ligne · ${queueSummary.pendingCount} vente(s) en attente de synchronisation`}
        />
      )}
      {user.permissions.includes("scanner.camera") && (
        <button type="button" onClick={() => setCamera(true)}>
          Scanner avec la caméra
        </button>
      )}
      {camera && (
        <CameraScanner
          onScan={(code) => void scan(code)}
          close={() => setCamera(false)}
        />
      )}
      {sale && (
        <Notice
          value={`Vente ${sale.saleNumber} enregistrée · ${centsToMad(sale.totalCents)}`}
        />
      )}{" "}
      {sale && !sale.saleNumber.startsWith("HORS-LIGNE") && (
        <button onClick={() => nav(`/sales/${sale.id}`)}>
          Voir et imprimer le reçu
        </button>
      )}
      <div className="pos-grid">
        <section>
          <label>
            Recherche ou scan
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Produit, SKU ou code"
              autoFocus
            />
          </label>
          {results.map((x) => (
            <button className="result" key={x.id} onClick={() => add(x)}>
              {x.name} · {centsToMad(x.sellingPriceCents)}{" "}
              {x.productType === "service"
                ? "· Service"
                : offline
                  ? `· Stock estimé lors de la dernière synchronisation : ${x.currentStock}`
                  : `· stock ${x.currentStock}`}
            </button>
          ))}
        </section>
        <section className="card">
          <h2>Panier</h2>
          {!cart.length ? (
            <p className="empty">Panier vide.</p>
          ) : (
            cart.map((line) => (
              <div className="cart-line" key={line.product.id}>
                <span>{line.product.name}</span>
                <input
                  type="number"
                  min="1"
                  max={
                    line.product.trackStock ? line.product.currentStock : 100000
                  }
                  value={line.quantity}
                  onChange={(e) =>
                    setCart(
                      cart.map((x) =>
                        x.product.id === line.product.id
                          ? {
                              ...x,
                              quantity: Math.max(1, Number(e.target.value)),
                            }
                          : x,
                      ),
                    )
                  }
                />
                <b>
                  {centsToMad(line.product.sellingPriceCents * line.quantity)}
                </b>
                <button
                  className="secondary"
                  onClick={() =>
                    setCart(
                      cart.filter((x) => x.product.id !== line.product.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))
          )}
          {cart.length > 0 && (
            <button
              className="secondary"
              onClick={() => confirm("Vider le panier ?") && setCart([])}
            >
              Vider
            </button>
          )}
          <h2>Total estimé : {centsToMad(total)}</h2>
          <label>
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              disabled={offline}
            >
              <option value="cash">Comptant</option>
              <option value="credit">Crédit</option>
              <option value="partial">Partiel</option>
            </select>
          </label>
          {mode !== "cash" && (
            <>
              <label>
                Rechercher client
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Choisir un client</option>
                {customers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · dette {centsToMad(x.currentDebtCents)}
                  </option>
                ))}
              </select>
              {has(user, "customers.manage") && (
                <Link to="/customers/new">Créer rapidement un client</Link>
              )}
            </>
          )}
          {mode === "partial" && (
            <label>
              Part comptant MAD
              <input value={cash} onChange={(e) => setCash(e.target.value)} />
              <small>Crédit estimé : {centsToMad(credit)}</small>
            </label>
          )}
          {mode !== "credit" && !status?.isOpen && (
            <div className="error">Caisse fermée.</div>
          )}
          <button disabled={busy || !cart.length} onClick={checkout}>
            {busy ? "Encaissement…" : offline ? "Mettre en file hors ligne" : "Valider la vente"}
          </button>
        </section>
      </div>
    </main>
  );
}

export function SalesPage() {
  const [search, setSearch] = useState(""),
    [mode, setMode] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<SaleListResponse>(),
    query = useDebounced(search);
  useEffect(() => {
    const c = new AbortController(),
      p = new URLSearchParams({ search: query, page: String(page) });
    if (mode) p.set("paymentMode", mode);
    request<SaleListResponse>(`/sales?${p}`, { signal: c.signal }).then(
      setData,
    );
    return () => c.abort();
  }, [query, mode, page]);
  return (
    <main className="page">
      <h1>Ventes</h1>
      <div className="filters">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Numéro ou client"
        />
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tous paiements</option>
          <option value="cash">Comptant</option>
          <option value="credit">Crédit</option>
          <option value="partial">Partiel</option>
        </select>
      </div>
      {!data ? (
        <p>Chargement…</p>
      ) : !data.rows.length ? (
        <p className="empty">Aucune vente.</p>
      ) : (
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Date</th>
                <th>Client</th>
                <th>Caissier</th>
                <th>Articles</th>
                <th>Total</th>
                <th>Paiement</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link to={`/sales/${x.id}`}>{x.saleNumber}</Link>
                  </td>
                  <td>{new Date(x.createdAt).toLocaleString("fr-MA")}</td>
                  <td>{x.customerName || "Comptoir"}</td>
                  <td>{x.workerName}</td>
                  <td>{x.itemCount}</td>
                  <td>{centsToMad(x.totalCents)}</td>
                  <td>{x.paymentMode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={data?.totalPages ?? 1} set={setPage} />
    </main>
  );
}
export function SaleDetails() {
  const { id } = useParams(),
    [sale, setSale] = useState<SaleDetail>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    request<SaleDetail>(`/sales/${id}`, { signal: c.signal })
      .then(setSale)
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => c.abort();
  }, [id]);
  return (
    <main className="page print-sheet">
      <ErrorBox value={error} />
      {sale && (
        <>
          <div className="title">
            <h1>Reçu {sale.saleNumber}</h1>
            <button onClick={() => window.print()}>Imprimer</button>
          </div>
          <div className="receipt-head">
            <b>{sale.shopName}</b>
            <span>{sale.shopAddress}</span>
            <span>{sale.shopPhone}</span>
            <span>{new Date(sale.createdAt).toLocaleString("fr-MA")}</span>
            <span>Caissier : {sale.workerName}</span>
            <span>Client : {sale.customerName || "Comptoir"}</span>
          </div>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Qté</th>
                  <th>Prix</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((x) => (
                  <tr key={x.id}>
                    <td>{x.productName}</td>
                    <td>{x.quantity}</td>
                    <td>{centsToMad(x.unitPriceCents)}</td>
                    <td>{centsToMad(x.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="details">
            <dt>Total</dt>
            <dd>
              <b>{centsToMad(sale.totalCents)}</b>
            </dd>
            <dt>Comptant</dt>
            <dd>{centsToMad(sale.cashPaidCents)}</dd>
            <dt>Crédit</dt>
            <dd>{centsToMad(sale.creditAmountCents)}</dd>
            <dt>Mode</dt>
            <dd>{sale.paymentMode}</dd>
          </dl>
          <p>{sale.receiptFooter}</p>
        </>
      )}
    </main>
  );
}

export function OfflineQueuePage() {
  const [queueSummary, setQueueSummary] = useState<OfflineQueueSummary>({ pendingCount: 0, syncingCount: 0, syncedCount: 0, rejectedCount: 0 }),
    [records, setRecords] = useState<OfflineSaleRecord[]>([]),
    [syncing, setSyncing] = useState(false),
    [cache, setCache] = useState<OfflineCacheStatus>(),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");

  const refreshQueue = async () => {
    const [summary, queue] = await Promise.all([getOfflineQueueSummary(), readQueueAsync()]);
    setQueueSummary(summary);
    setRecords(queue);
    setCache(await getOfflineCacheStatus());
  };
  const handleCacheRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const register = await request<RegisterStatus>("/register/status");
      await refreshOfflineCache({ isOpen: register.isOpen, sessionId: register.sessionId });
      await refreshQueue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Actualisation impossible.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshQueue();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncPendingOfflineSales();
      await refreshQueue();
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="page">
      <div className="title">
        <h1>File hors ligne</h1>
        <Link to="/pos">Retour au point de vente</Link>
      </div>
      <ErrorBox value={error} />
      <p>Dernière actualisation : {cache?.lastRefreshAt ? new Date(cache.lastRefreshAt).toLocaleString("fr-FR") : "Jamais"} · {cache?.productCount ?? 0} produit(s) en cache.</p>
      <button className="secondary" onClick={handleCacheRefresh} disabled={refreshing}>
        {refreshing ? "Actualisation…" : "Actualiser les données hors ligne"}
      </button>
      <div className="summary-cards">
        <div className="card">
          <dt>Synchronisation</dt>
          <dd>{queueSummary.syncingCount}</dd>
        </div>
        <div className="card">
          <dt>En attente</dt>
          <dd>{queueSummary.pendingCount}</dd>
        </div>
        <div className="card">
          <dt>Synchronisées</dt>
          <dd>{queueSummary.syncedCount}</dd>
        </div>
        <div className="card">
          <dt>Rejetées</dt>
          <dd>{queueSummary.rejectedCount}</dd>
        </div>
      </div>
      {queueSummary.pendingCount > 0 && (
        <button
          className="primary"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? "Synchronisation..." : "Synchroniser maintenant"}
        </button>
      )}
      {!records.length ? (
        <p className="empty">Aucune vente dans la file.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Articles</th>
              <th>Total</th>
              <th>Tentatives</th>
              <th>Erreur</th>
              <th>Vente serveur</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record: OfflineSaleRecord) => (
              <tr key={record.id}>
                <td>
                  <code>{record.id.slice(0, 8).toUpperCase()}</code>
                </td>
                <td>{new Date(record.createdAt).toLocaleString("fr-FR")}</td>
                <td>
                  <span
                    className={`badge ${
                      record.status === "synced"
                        ? "success"
                        : record.status === "rejected"
                          ? "danger"
                          : record.status === "syncing"
                            ? "warning"
                            : "info"
                    }`}
                  >
                    {record.status === "synced"
                      ? "Synchronisée"
                      : record.status === "rejected"
                        ? "Rejetée"
                        : record.status === "syncing"
                          ? "Synchronisation"
                          : "En attente"}
                  </span>
                </td>
                <td>{record.payload.items.length}</td>
                <td>
                  {centsToMad(
                    record.payload.items.reduce(
                      (sum, item) => sum + item.quantity * item.cachedUnitPriceCents,
                      0,
                    ),
                  )}
                </td>
                <td>{record.attemptCount}</td>
                <td>{record.lastError || "-"}</td>
                <td>
                  {record.serverEntityId ? `Vente #${record.serverEntityId}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function Pager({
  page,
  total,
  set,
}: {
  page: number;
  total: number;
  set: (value: number) => void;
}) {
  return (
    <div className="pager">
      <button disabled={page <= 1} onClick={() => set(page - 1)}>
        Précédent
      </button>
      <span>
        {page} / {total}
      </span>
      <button disabled={page >= total} onClick={() => set(page + 1)}>
        Suivant
      </button>
    </div>
  );
}
