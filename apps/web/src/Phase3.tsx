import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Customer,
  CustomerCreditListResponse,
  CustomerListResponse,
  PriceAdjustmentType,
  ProductListResponse,
  ProductListRow,
  ProductLookup,
  ProductUnitLookup,
  RegisterMovementListResponse,
  RegisterSession,
  RegisterSessionListResponse,
  RegisterStatus,
  SafeUser,
  SaleDetail,
  SaleListResponse,
  SaleResult,
} from "@maktaba/shared-types";
import { ApiFailure, request } from "./api";
import { centsToMad, madToCents } from "./money";
import CameraScanner from "./CameraScanner";
import { enqueueGlobalScan, globalScanQueue } from "./global-scanner";
import { normalizeScannedCode } from "./scanner";
import {
  addCartProduct,
  addSerializedCartUnit,
  calculateCartPriceAdjustment,
  cartLineUnitPrice,
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
  findCachedSerializedUnit,
  getCachedProducts,
  getOfflineCacheStatus,
  getOfflineQueueSummary,
  estimatedStock,
  queueOfflineSale,
  refreshOfflineCache,
  syncPendingOfflineSales,
  readQueueAsync,
  isTauriRuntime,
  reserveCachedSerializedUnit,
  releaseCachedSerializedUnits,
} from "./offline-pos";
import type { OfflineCacheStatus, OfflineQueueSummary, OfflineSaleRecord } from "./offline-pos";
import { isAbortError } from "./request-error";

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
    let active = true;
    request<RegisterStatus>("/register/status", { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setStatus(result);
        setError("");
      })
      .catch((reason: unknown) => {
        if (active && !isAbortError(reason))
          setError(reason instanceof Error ? reason.message : "Erreur");
      });
    return () => {
      active = false;
      controller.abort();
    };
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
    let active = true;
    request<RegisterSessionListResponse>(`/register/sessions?page=${page}`, {
      signal: c.signal,
    })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e))
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
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
    let active = true;
    request<CustomerListResponse>(`/customers?${p}`, { signal: c.signal })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e))
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
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
    let active = true;
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
        if (!active) return;
        setCustomer(a);
        setLedger(b);
        setSales(d);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e))
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
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

interface PriceEditorState {
  productId: number;
  type: PriceAdjustmentType;
  value: string;
  reason: string;
  customReason: string;
}

const priceAdjustmentLabels: Record<PriceAdjustmentType, string> = {
  final_unit_price: "Prix unitaire final",
  fixed_discount: "Remise fixe",
  percentage_discount: "Remise en pourcentage",
  fixed_markup: "Majoration fixe",
  percentage_markup: "Majoration en pourcentage",
};
const priceAdjustmentReasons = [
  "Remise client",
  "Client fidèle",
  "Promotion exceptionnelle",
  "Produit légèrement endommagé",
  "Négociation commerciale",
  "Correction de prix",
  "Autre",
] as const;

export function PosPage({ user }: { user: SafeUser }) {
  const [cart, setCart] = useState<CartLine[]>([]),
    [priceEditor, setPriceEditor] = useState<PriceEditorState>(),
    [priceError, setPriceError] = useState(""),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ProductListRow[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [customerQuery, setCustomerQuery] = useState(""),
    [customerId, setCustomerId] = useState(""),
    [mode, setMode] = useState<"cash" | "credit" | "partial">("cash"),
    [cash, setCash] = useState(""),
    [status, setStatus] = useState<RegisterStatus>(),
    [registerLoaded, setRegisterLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sale, setSale] = useState<SaleResult | { id: string; saleNumber: string; totalCents: number }>(),
    [camera, setCamera] = useState(false),
    [scannerState, setScannerState] = useState("Scanner prêt"),
    [lastScannedCode, setLastScannedCode] = useState(""),
    [connectionState, setConnectionState] = useState<"online" | "offline" | "checking">("checking"),
    [queueSummary, setQueueSummary] = useState<OfflineQueueSummary>({ pendingCount: 0, syncingCount: 0, syncedCount: 0, rejectedCount: 0 }),
    nav = useNavigate(),
    search = useDebounced(query),
    cq = useDebounced(customerQuery),
    total = estimatedCartTotal(cart),
    checkoutLock = useRef(false),
    offlineReservationId = useRef(`cart-${crypto.randomUUID()}`);
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
  useEffect(() => () => {
    if (isTauriRuntime()) void releaseCachedSerializedUnits(offlineReservationId.current);
  }, []);
  useEffect(() => {
    setRegisterLoaded(false);
    if (connectionState === "offline") {
      void getOfflineCacheStatus().then((cached) => {
        if (cached?.register) setStatus({ isOpen: cached.register.isOpen, sessionId: cached.register.sessionId } as RegisterStatus);
      }).finally(() => setRegisterLoaded(true));
      return;
    }
    if (connectionState !== "online") return;
    request<RegisterStatus>("/register/status")
      .then((value) => {
        setStatus(value);
        if (isTauriRuntime()) void refreshOfflineCache({ isOpen: value.isOpen, sessionId: value.sessionId });
      })
      .catch(() => undefined)
      .finally(() => setRegisterLoaded(true));
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
    void syncPendingOfflineSales(request, user.id).finally(() => void getOfflineQueueSummary().then(setQueueSummary));
  }, [connectionState, user.id]);
  const add = useCallback((product: ProductListRow) => {
    if (product.inventoryMode === "serialized") {
      setScannerState("Code unitaire requis");
      setError("Scannez le code-barres individuel d’une unité disponible.");
      return;
    }
    if (
      product.productType === "physical_product" &&
      product.trackStock &&
      product.currentStock <= 0
    )
      {
        setScannerState("Stock insuffisant");
        return setError("Stock insuffisant pour ce produit.");
      }
    setQuery("");
    setResults([]);
    setCart((value) => {
      const quantity = value.find((line) => line.product.id === product.id)?.quantity ?? 0;
      if (product.productType === "physical_product" && product.trackStock && quantity >= product.currentStock) {
        setError("Stock insuffisant pour ce produit.");
        setScannerState("Stock insuffisant");
        return value;
      }
      setScannerState(`${product.name} ajouté — Quantité : ${quantity + 1}`);
      setError("");
      return addCartProduct(value, product);
    });
  }, []);
  const scan = useCallback(async (rawCode: string) => {
    const code = normalizeScannedCode(rawCode);
    if (code.length < 3) return;

    setQuery("");
    setResults([]);
    setError("");
    setLastScannedCode(code);
    setScannerState("Recherche…");
    try {
      if (connectionState === "offline" && !status)
        throw new Error("Le catalogue hors ligne n’est pas disponible. Actualisez le cache lorsque la connexion revient.");
      if (!status?.isOpen)
        throw new Error("La caisse doit être ouverte avant de commencer une vente.");
      let serialized: ProductUnitLookup | undefined;
      let cachedSerialized: Awaited<ReturnType<typeof findCachedSerializedUnit>>;
      if (connectionState === "online") {
        try {
          serialized = await request<ProductUnitLookup>(
            `/product-units/lookup/${encodeURIComponent(code)}`,
          );
        } catch (e) {
          if (!(e instanceof ApiFailure) || e.status !== 404) throw e;
        }
      } else {
        cachedSerialized = await findCachedSerializedUnit(code);
        if (cachedSerialized) {
          if (!cachedSerialized.productActive || cachedSerialized.status !== "available")
            throw new Error("Cette unité a déjà été vendue ou n’est plus disponible.");
          if (cachedSerialized.reservationId)
            throw new Error("Cette unité est déjà réservée localement.");
          await reserveCachedSerializedUnit(code, offlineReservationId.current);
        }
      }
      const cachedProduct: ProductListRow | undefined = cachedSerialized
        ? {
            id: cachedSerialized.productId, categoryId: null, categoryName: null,
            name: cachedSerialized.productName, productType: "physical_product",
            inventoryMode: "serialized", sku: null, internalBarcode: "",
            sellingPriceCents: cachedSerialized.sellingPriceCents, currentStock: 1,
            minimumStock: 0, unit: "unité", shelfLocation: null, isActive: true,
            trackStock: true, isLowStock: false, isOutOfStock: false,
          }
        : undefined;
      const product = serialized?.product ?? cachedProduct ??
        (connectionState === "offline"
          ? await findCachedProductByCode(code)
          : (await request<ProductLookup>(`/products/lookup/${encodeURIComponent(code)}`)).product);
      if (!product) throw new Error(`Produit introuvable · Code-barres : ${code}`);
      if (!product.isActive) throw new Error("Ce produit est archivé et ne peut pas être vendu.");
      if (serialized || cachedSerialized) {
        const unitBarcode = serialized?.unit.barcode ?? cachedSerialized!.barcode;
        if (serialized && serialized.unit.status !== "available")
          throw new Error("Cette unité n’est pas disponible.");
        setCart((value) => {
          if (value.some((line) => line.unitBarcodes?.includes(unitBarcode))) {
            setError("Cette unité est déjà dans le panier.");
            return value;
          }
          setScannerState(`${product.name} ajouté — unité ${unitBarcode}`);
          setError("");
          return addSerializedCartUnit(value, { ...product, inventoryMode: "serialized" }, unitBarcode);
        });
      } else if (product.inventoryMode === "serialized") {
        throw new Error("Scannez le code-barres individuel d’une unité disponible.");
      } else add(product);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Produit introuvable";
      setError(message);
      setScannerState(
        message.startsWith("Stock")
          ? "Stock insuffisant"
          : message.startsWith("Produit introuvable")
            ? "Produit introuvable"
            : "Erreur scanner",
      );
    }
  }, [add, connectionState, status]);
  useEffect(
    () => registerLoaded ? globalScanQueue.register(({ barcode }) => scan(barcode)) : undefined,
    [registerLoaded, scan],
  );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "F2" || (event.ctrlKey && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-pos-search]")?.focus();
      }
      if (event.key === "Escape") setCamera(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const checkout = async () => {
    if (checkoutLock.current || !cart.length) return;
    if (offline && cart.some((line) => line.priceAdjustment))
      return setError(
        "La modification manuelle du prix nécessite une connexion au serveur.",
      );
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
          unitBarcodes: x.unitBarcodes,
          finalUnitPriceCents: x.priceAdjustment?.finalUnitPriceCents,
          priceAdjustmentType: x.priceAdjustment?.type,
          priceAdjustmentValue: x.priceAdjustment?.value,
          priceAdjustmentReason: x.priceAdjustment?.reason,
        })),
        paymentMode: mode,
        cashPaidCents: mode === "partial" ? cashCents : 0,
        idempotencyKey,
      };
      if (offline) {
        if (!isTauriRuntime()) throw new Error("Les ventes hors ligne sont réservées à l’application de bureau.");
        if (!status?.sessionId) throw new Error("Une caisse ouverte observée en ligne est requise.");
        const offlineItems = await Promise.all(cart.map(async (line) => {
          const units = await Promise.all((line.unitBarcodes ?? []).map(async (barcode) => {
            const unit = await findCachedSerializedUnit(barcode);
            if (!unit || unit.reservationId !== offlineReservationId.current)
              throw new Error("Une unité sérialisée n’est plus réservée pour ce panier.");
            return { id: unit.id, barcode: unit.barcode };
          }));
          return {
            productId: line.product.id, quantity: line.quantity,
            cachedUnitPriceCents: line.product.sellingPriceCents,
            unitBarcodes: units.length ? units.map((unit) => unit.barcode) : undefined,
            serializedUnits: units.length ? units : undefined,
          };
        }));
        const id = await queueOfflineSale({
          schemaVersion: 1,
          customerId: null,
          items: offlineItems,
          paymentMode: "cash",
          cashPaidCents: 0,
          idempotencyKey,
          clientTimestamp: new Date().toISOString(),
          registerIdSnapshot: status.sessionId,
          userSnapshot: { id: user.id, fullName: user.fullName, role: user.role },
        }, offlineReservationId.current);
        setSale({
          id,
          saleNumber: `HORS-LIGNE #${id.slice(0, 8).toUpperCase()}`,
          totalCents: total,
        });
        setCart([]);
        offlineReservationId.current = `cart-${crypto.randomUUID()}`;
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
      {error.startsWith("La caisse doit") && user.permissions.includes("register.open") && (
        <Link className="button secondary" to="/register">Ouvrir la caisse</Link>
      )}
      {error.startsWith("Produit introuvable") && ["global_admin", "manager"].includes(user.role) && (
        <Link className="button secondary" to={`/products/new?barcode=${encodeURIComponent(lastScannedCode)}`}>Créer ce produit</Link>
      )}
      <div className="scanner-status" role="status" aria-live="polite">{scannerState}</div>
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
          onScan={(code) => enqueueGlobalScan(code, "camera")}
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
      {priceEditor && (() => {
        const line = cart.find(
          (item) => item.product.id === priceEditor.productId,
        );
        if (!line) return null;
        const reason =
          priceEditor.reason === "Autre"
            ? priceEditor.customReason
            : priceEditor.reason;
        let preview: ReturnType<typeof calculateCartPriceAdjustment> | undefined;
        try {
          const rawValue = priceEditor.value.trim().replace(",", ".");
          const value = priceEditor.type.includes("percentage")
            ? Math.round(Number(rawValue) * 100)
            : madToCents(rawValue);
          if (!Number.isFinite(value) || value < 0) throw new Error("Valeur invalide.");
          preview = calculateCartPriceAdjustment(
            line.product.sellingPriceCents,
            priceEditor.type,
            value,
            reason,
          );
        } catch {
          preview = undefined;
        }
        const belowCost =
          preview &&
          Number(line.product.purchasePriceCents ?? 0) > 0 &&
          preview.finalUnitPriceCents < Number(line.product.purchasePriceCents);
        return (
          <div
            className="scanner-unknown"
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-editor-title"
          >
            <div className="section-card" data-scanner-blocking="true">
              <h2 id="price-editor-title">Modifier le prix</h2>
              <p><b>{line.product.name}</b></p>
              <dl className="details">
                <dt>Prix normal</dt>
                <dd>{centsToMad(line.product.sellingPriceCents)}</dd>
                <dt>Quantité</dt>
                <dd>{line.quantity}</dd>
                <dt>Prix appliqué actuellement</dt>
                <dd>{centsToMad(cartLineUnitPrice(line))}</dd>
              </dl>
              <label>
                Mode de modification
                <select
                  value={priceEditor.type}
                  onChange={(event) =>
                    setPriceEditor({
                      ...priceEditor,
                      type: event.target.value as PriceAdjustmentType,
                      value: "",
                    })
                  }
                >
                  {Object.entries(priceAdjustmentLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                {priceEditor.type.includes("percentage")
                  ? "Pourcentage (%)"
                  : priceEditor.type === "final_unit_price"
                    ? "Nouveau prix unitaire (MAD)"
                    : "Montant (MAD)"}
                <input
                  type="number"
                  min="0"
                  max={
                    priceEditor.type === "percentage_discount"
                      ? "99.99"
                      : priceEditor.type === "percentage_markup"
                        ? "10000"
                        : undefined
                  }
                  step="0.01"
                  value={priceEditor.value}
                  inputMode="decimal"
                  autoFocus
                  onChange={(event) =>
                    setPriceEditor({ ...priceEditor, value: event.target.value })
                  }
                />
              </label>
              <label>
                Raison
                <select
                  value={priceEditor.reason}
                  onChange={(event) =>
                    setPriceEditor({ ...priceEditor, reason: event.target.value })
                  }
                >
                  {priceAdjustmentReasons.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              {priceEditor.reason === "Autre" && (
                <label>
                  Explication
                  <textarea
                    value={priceEditor.customReason}
                    onChange={(event) =>
                      setPriceEditor({
                        ...priceEditor,
                        customReason: event.target.value,
                      })
                    }
                  />
                </label>
              )}
              {preview && (
                <div className="notice">
                  Nouveau prix : <b>{centsToMad(preview.finalUnitPriceCents)}</b><br />
                  Total de la ligne : {centsToMad(preview.finalUnitPriceCents * line.quantity)}<br />
                  Différence unitaire : {centsToMad(preview.finalUnitPriceCents - line.product.sellingPriceCents)}
                </div>
              )}
              {belowCost && (
                <div className="error">
                  Le prix final est inférieur au prix d’achat.
                  {!has(user, "sales.sell_below_cost") &&
                    " Une autorisation supplémentaire est requise."}
                </div>
              )}
              <ErrorBox value={priceError} />
              <div className="inline-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPriceEditor(undefined)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={
                    offline ||
                    !preview ||
                    Boolean(belowCost && !has(user, "sales.sell_below_cost"))
                  }
                  onClick={() => {
                    try {
                      const rawValue = priceEditor.value.trim().replace(",", ".");
                      const value = priceEditor.type.includes("percentage")
                        ? Math.round(Number(rawValue) * 100)
                        : madToCents(rawValue);
                      const adjustment = calculateCartPriceAdjustment(
                        line.product.sellingPriceCents,
                        priceEditor.type,
                        value,
                        reason,
                      );
                      if (
                        Number(line.product.purchasePriceCents ?? 0) > 0 &&
                        adjustment.finalUnitPriceCents <
                          Number(line.product.purchasePriceCents) &&
                        !has(user, "sales.sell_below_cost")
                      )
                        throw new Error(
                          "La vente sous le prix d’achat nécessite une autorisation supplémentaire.",
                        );
                      setCart(
                        cart.map((item) =>
                          item.product.id === line.product.id
                            ? { ...item, priceAdjustment: adjustment }
                            : item,
                        ),
                      );
                      setPriceEditor(undefined);
                      setPriceError("");
                    } catch (reasonValue) {
                      setPriceError(
                        reasonValue instanceof Error
                          ? reasonValue.message
                          : "Modification du prix invalide.",
                      );
                    }
                  }}
                >
                  Appliquer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="pos-grid">
        <section>
          <label>
            Recherche ou scan
            <input
              data-pos-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                const code = normalizeScannedCode(event.currentTarget.value);
                if (code.length < 3) return;
                void scan(code);
              }}
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
                  disabled={line.product.inventoryMode === "serialized"}
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
                {line.unitBarcodes?.length ? (
                  <small className="serialized-cart-units">{line.unitBarcodes.join(" · ")}</small>
                ) : null}
                <div>
                  {line.priceAdjustment && (
                    <small>
                      Prix normal : {centsToMad(line.product.sellingPriceCents)}
                    </small>
                  )}
                  <b>{centsToMad(cartLineUnitPrice(line) * line.quantity)}</b>
                  <small>
                    {centsToMad(cartLineUnitPrice(line))} × {line.quantity}
                  </small>
                </div>
                {has(user, "sales.adjust_price") && (
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={offline}
                      onClick={() => {
                        if (offline) {
                          setError(
                            "La modification manuelle du prix nécessite une connexion au serveur.",
                          );
                          return;
                        }
                        setPriceError("");
                        const existingReason =
                          line.priceAdjustment?.reason ??
                          "Négociation commerciale";
                        const knownReason =
                          existingReason !== "Autre" &&
                          priceAdjustmentReasons.includes(
                            existingReason as (typeof priceAdjustmentReasons)[number],
                          );
                        const existingValue = line.priceAdjustment
                          ? (line.priceAdjustment.value / 100).toFixed(2)
                          : (line.product.sellingPriceCents / 100).toFixed(2);
                        setPriceEditor({
                          productId: line.product.id,
                          type: line.priceAdjustment?.type ?? "final_unit_price",
                          value: existingValue,
                          reason: knownReason ? existingReason : "Autre",
                          customReason: knownReason ? "" : existingReason,
                        });
                      }}
                    >
                      Modifier le prix
                    </button>
                    {line.priceAdjustment && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setCart(
                            cart.map((item) =>
                              item.product.id === line.product.id
                                ? { ...item, priceAdjustment: undefined }
                                : item,
                            ),
                          )
                        }
                      >
                        Réinitialiser le prix
                      </button>
                    )}
                  </div>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    void (async () => {
                      if (offline)
                        for (const barcode of line.unitBarcodes ?? [])
                          await releaseCachedSerializedUnits(offlineReservationId.current, barcode);
                      setCart(cart.filter((x) => x.product.id !== line.product.id));
                    })()
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
              onClick={() => {
                if (!confirm("Vider le panier ?")) return;
                if (offline) void releaseCachedSerializedUnits(offlineReservationId.current);
                setCart([]);
                offlineReservationId.current = `cart-${crypto.randomUUID()}`;
              }}
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
    let active = true;
    if (mode) p.set("paymentMode", mode);
    void request<SaleListResponse>(`/sales?${p}`, { signal: c.signal })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return;
        console.error(error);
      });
    return () => {
      active = false;
      c.abort();
    };
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
    [format, setFormat] = useState<"thermal" | "a4">(() =>
      window.localStorage.getItem("maktaba-receipt-format") === "a4" ? "a4" : "thermal",
    ),
    [logoFailed, setLogoFailed] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    let active = true;
    request<SaleDetail>(`/sales/${id}`, { signal: c.signal })
      .then((result) => {
        if (!active) return;
        setSale(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e))
          setError(e instanceof Error ? e.message : "Erreur");
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [id]);
  return (
    <main className={`page print-sheet receipt-format-${format}`}>
      <ErrorBox value={error} />
      {sale && (
        <>
          <div className="title">
            <h1>Reçu {sale.saleNumber}</h1>
            <div className="inline-actions">
              <select aria-label="Format du reçu" value={format} onChange={(event) => {
                const next = event.target.value as "thermal" | "a4";
                setFormat(next);
                window.localStorage.setItem("maktaba-receipt-format", next);
              }}>
                <option value="thermal">Ticket thermique 80 mm</option>
                <option value="a4">Document A4</option>
              </select>
              <button onClick={() => window.print()}>Imprimer le reçu</button>
            </div>
          </div>
          <section className="receipt-document">
          <div className="receipt-head">
            {!logoFailed && <img className="receipt-logo" src="/branding/logo-doubel.png" alt="Double Library" onError={() => setLogoFailed(true)} />}
            <b>{sale.shopName || "Double Library"}</b>
            <span>{sale.shopAddress}</span>
            <span>Téléphone : {sale.shopPhone || "0713010739"}</span>
            <strong>TICKET DE CAISSE</strong>
            <span>{new Date(sale.createdAt).toLocaleString("fr-MA")}</span>
            <span>Caissier : {sale.workerName}</span>
            <span>Client : {sale.customerName || "Comptoir"}</span>
          </div>
          <dl className="receipt-meta">
            <dt>N° Ticket</dt><dd>{sale.saleNumber}</dd>
            <dt>Client</dt><dd>{sale.customerName || "Client comptoir"}</dd>
            <dt>Vendeur</dt><dd>{sale.workerName}</dd>
            <dt>Mode de paiement</dt><dd>{{ cash: "Espèces", credit: "Crédit client", partial: "Espèces + Crédit" }[sale.paymentMode]}</dd>
          </dl>
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
                    <td>
                      {x.productName}
                      {x.priceAdjustmentType && (
                        <small>
                          {x.priceAdjustmentReason || "Prix ajusté"}
                        </small>
                      )}
                    </td>
                    <td>{x.quantity}</td>
                    <td>
                      {x.priceAdjustmentType &&
                        x.baseUnitPriceCents !== x.unitPriceCents && (
                          <small>
                            Prix normal : {centsToMad(x.baseUnitPriceCents)}
                          </small>
                        )}
                      {centsToMad(x.unitPriceCents)}
                    </td>
                    <td>{centsToMad(x.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="details">
            <dt>Sous-total</dt><dd>{centsToMad(sale.subtotalCents)}</dd>
            {sale.discountCents > 0 && <><dt>Remise</dt><dd>- {centsToMad(sale.discountCents)}</dd></>}
            {sale.markupCents > 0 && <><dt>Majoration</dt><dd>+ {centsToMad(sale.markupCents)}</dd></>}
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
            {sale.changeCents > 0 && <><dt>Monnaie rendue</dt><dd>{centsToMad(sale.changeCents)}</dd></>}
            <dt className="receipt-grand-total">TOTAL À PAYER</dt><dd className="receipt-grand-total">{centsToMad(sale.totalCents)}</dd>
          </dl>
          <footer className="receipt-footer"><p>Merci de votre visite !</p><p>{sale.receiptFooter || "Merci pour votre confiance"}</p></footer>
          </section>
        </>
      )}
    </main>
  );
}

export function OfflineQueuePage({ user }: { user: SafeUser }) {
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
      await syncPendingOfflineSales(request, user.id);
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
      <p>Unités sérialisées : {cache?.serializedUnitCount ?? 0} · disponibles : {cache?.availableSerializedUnitCount ?? 0} · réservées/en attente : {cache?.pendingSerializedUnitCount ?? 0}.</p>
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
                <td>
                  {record.payload.items.reduce((sum, item) => sum + item.quantity, 0)}
                  {record.payload.items.some((item) => item.serializedUnits?.length) && (
                    <small className="queue-unit-barcodes">
                      {record.payload.items.flatMap((item) => item.serializedUnits ?? []).map((unit) => unit.barcode).join(" · ")}
                    </small>
                  )}
                </td>
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
