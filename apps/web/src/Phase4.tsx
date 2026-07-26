import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  Expense,
  ExpenseListResponse,
  ProductListResponse,
  ProductListRow,
  PurchaseDetail,
  PurchaseListResponse,
  RegisterStatus,
  ReturnDetail,
  ReturnListResponse,
  ReturnableItem,
  SafeUser,
  Supplier,
  SupplierLedgerResponse,
  SupplierListResponse,
  BarcodeResolution,
} from "@maktaba/shared-types";
import { request } from "./api";
import { centsToMad, madToCents } from "./money";
import {
  purchaseCredit,
  purchaseTotal,
  refundAllocation,
  supplierDebtAfterPayment,
  type PurchaseDraftLine,
} from "./phase4-utils";
import { useScannerContext } from "./scanner-context";
import CameraScanner from "./CameraScanner";
import { isAbortError } from "./request-error";

const allowed = (user: SafeUser, permission: string) =>
  user.permissions.includes(permission);
const ErrorBox = ({ value }: { value: string }) =>
  value ? <div className="error">{value}</div> : null;
function useDebounced(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Une erreur est survenue.";

export function SuppliersPage({ user }: { user: SafeUser }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [data, setData] = useState<SupplierListResponse>(),
    [error, setError] = useState("");
  const query = useDebounced(search);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    request<SupplierListResponse>(
      `/suppliers?search=${encodeURIComponent(query)}&status=${status}&pageSize=50`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e)) setError(errorMessage(e));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [query, status]);
  return (
    <main className="page">
      <div className="title">
        <h1>Fournisseurs</h1>
        {allowed(user, "suppliers.manage") && (
          <Link className="button" to="/suppliers/new">
            Nouveau
          </Link>
        )}
      </div>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom, téléphone ou e-mail"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Tous</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
      </div>
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Contact</th>
              <th>Dette</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((supplier) => (
              <tr key={supplier.id}>
                <td>
                  <Link to={`/suppliers/${supplier.id}`}>{supplier.name}</Link>
                </td>
                <td>{supplier.phone || supplier.email || "—"}</td>
                <td>{centsToMad(supplier.currentDebtCents)}</td>
                <td>{supplier.isActive ? "Actif" : "Inactif"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export function SupplierForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    navigate = useNavigate(),
    [supplier, setSupplier] = useState<Supplier>(),
    [error, setError] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    if (edit)
      request<Supplier>(`/suppliers/${id}`)
        .then(setSupplier)
        .catch((e) => setError(errorMessage(e)));
  }, [edit, id]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const form = new FormData(event.currentTarget);
    try {
      const result = await request<Supplier>(
        edit ? `/suppliers/${id}` : "/suppliers",
        {
          method: edit ? "PATCH" : "POST",
          json: {
            name: form.get("name"),
            phone: form.get("phone") || null,
            email: form.get("email") || null,
            address: form.get("address") || null,
            notes: form.get("notes") || null,
          },
        },
      );
      navigate(`/suppliers/${result.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  };
  if (edit && !supplier)
    return (
      <main className="page">
        <ErrorBox value={error} />
      </main>
    );
  return (
    <main className="page narrow">
      <h1>{edit ? "Modifier le fournisseur" : "Nouveau fournisseur"}</h1>
      <ErrorBox value={error} />
      <form onSubmit={submit}>
        <input
          name="name"
          defaultValue={supplier?.name}
          placeholder="Nom"
          required
        />
        <input
          name="phone"
          defaultValue={supplier?.phone ?? ""}
          placeholder="Téléphone"
        />
        <input
          name="email"
          type="email"
          defaultValue={supplier?.email ?? ""}
          placeholder="E-mail"
        />
        <textarea
          name="address"
          defaultValue={supplier?.address ?? ""}
          placeholder="Adresse"
        />
        <textarea
          name="notes"
          defaultValue={supplier?.notes ?? ""}
          placeholder="Notes"
        />
        <button>Enregistrer</button>
      </form>
    </main>
  );
}

export function SupplierDetails({ user }: { user: SafeUser }) {
  const { id } = useParams(),
    [supplier, setSupplier] = useState<Supplier>(),
    [ledger, setLedger] = useState<SupplierLedgerResponse>(),
    [purchases, setPurchases] = useState<PurchaseListResponse>(),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      request<Supplier>(`/suppliers/${id}`),
      allowed(user, "supplier_credit.view")
        ? request<SupplierLedgerResponse>(`/suppliers/${id}/ledger?pageSize=20`)
        : Promise.resolve(undefined),
      request<PurchaseListResponse>(`/purchases?supplierId=${id}&pageSize=10`),
    ])
      .then(([s, l, p]) => {
        setSupplier(s);
        setLedger(l);
        setPurchases(p);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id, user]);
  const toggle = async () => {
    if (!supplier) return;
    try {
      setSupplier(
        await request<Supplier>(
          `/suppliers/${id}/${supplier.isActive ? "deactivate" : "activate"}`,
          { method: "POST" },
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <main className="page">
      <ErrorBox value={error} />
      {supplier && (
        <>
          <div className="title">
            <h1>{supplier.name}</h1>
            <div>
              {allowed(user, "supplier_credit.manage") &&
                supplier.currentDebtCents > 0 && (
                  <Link className="button" to={`/suppliers/${id}/payment`}>
                    Payer
                  </Link>
                )}{" "}
              {allowed(user, "suppliers.manage") && (
                <>
                  <Link to={`/suppliers/${id}/edit`}>Modifier</Link>{" "}
                  <button onClick={toggle}>
                    {supplier.isActive ? "Désactiver" : "Activer"}
                  </button>
                </>
              )}
            </div>
          </div>
          <p>
            {supplier.phone || "—"} · {supplier.email || "—"}
          </p>
          <h2>Dette : {centsToMad(supplier.currentDebtCents)}</h2>
          <h2>Grand livre</h2>
          {ledger?.rows.map((row) => (
            <p key={row.id}>
              {row.transactionType} · {centsToMad(row.amountCents)} · solde{" "}
              {centsToMad(row.balanceAfterCents)}
            </p>
          ))}
          <h2>Achats récents</h2>
          {purchases?.rows.map((row) => (
            <p key={row.id}>
              <Link to={`/purchases/${row.id}`}>{row.purchaseNumber}</Link> ·{" "}
              {centsToMad(row.totalCents)}
            </p>
          ))}
        </>
      )}
    </main>
  );
}

export function SupplierPayment() {
  const { id } = useParams(),
    navigate = useNavigate(),
    [supplier, setSupplier] = useState<Supplier>(),
    [amount, setAmount] = useState(""),
    [source, setSource] = useState("cash_register"),
    [register, setRegister] = useState<RegisterStatus>(),
    [error, setError] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    Promise.all([
      request<Supplier>(`/suppliers/${id}`),
      request<RegisterStatus>("/register/status"),
    ])
      .then(([s, r]) => {
        setSupplier(s);
        setRegister(r);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  let cents = 0;
  try {
    cents = amount ? madToCents(amount) : 0;
  } catch {
    cents = 0;
  }
  const after = supplierDebtAfterPayment(
    supplier?.currentDebtCents ?? 0,
    cents,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || after < 0) return;
    busy.current = true;
    try {
      await request(`/suppliers/${id}/payments`, {
        method: "POST",
        json: {
          amountCents: cents,
          paymentSource: source,
          note: new FormData(event.currentTarget).get("note"),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/suppliers/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  };
  return (
    <main className="page narrow">
      <h1>Paiement fournisseur</h1>
      <ErrorBox value={error} />
      <p>
        Dette : {centsToMad(supplier?.currentDebtCents ?? 0)} · après :{" "}
        {centsToMad(Math.max(0, after))}
      </p>
      {after < 0 && <div className="error">Le paiement dépasse la dette.</div>}
      {source === "cash_register" && !register?.sessionId && (
        <div className="error">Ouvrez une caisse.</div>
      )}
      <form onSubmit={submit}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant MAD"
          required
        />
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="cash_register">Caisse</option>
          <option value="external_cash">Espèces externes</option>
        </select>
        <textarea name="note" placeholder="Note" />
        <button
          disabled={
            !cents ||
            after < 0 ||
            (source === "cash_register" && !register?.sessionId)
          }
        >
          Confirmer
        </button>
      </form>
    </main>
  );
}

export function PurchasesPage() {
  const [search, setSearch] = useState(""),
    [data, setData] = useState<PurchaseListResponse>(),
    [error, setError] = useState("");
  const query = useDebounced(search);
  useEffect(() => {
    const c = new AbortController();
    let active = true;
    request<PurchaseListResponse>(
      `/purchases?search=${encodeURIComponent(query)}&pageSize=50`,
      { signal: c.signal },
    )
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((e: unknown) => {
        if (active && !isAbortError(e)) setError(errorMessage(e));
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [query]);
  return (
    <main className="page">
      <div className="title">
        <h1>Achats</h1>
        <Link className="button" to="/purchases/new">
          Nouvel achat
        </Link>
      </div>
      <ErrorBox value={error} />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Numéro, facture ou fournisseur"
      />
      <table>
        <thead>
          <tr>
            <th>Numéro</th>
            <th>Fournisseur</th>
            <th>Total</th>
            <th>Crédit</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/purchases/${row.id}`}>{row.purchaseNumber}</Link>
              </td>
              <td>{row.supplierName}</td>
              <td>{centsToMad(row.totalCents)}</td>
              <td>{centsToMad(row.creditAmountCents)}</td>
              <td>{new Date(row.createdAt).toLocaleString("fr-MA")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function PurchaseForm({ user }: { user: SafeUser }) {
  const navigate = useNavigate(),
    [supplierSearch, setSupplierSearch] = useState(""),
    [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [supplierId, setSupplierId] = useState(""),
    [productSearch, setProductSearch] = useState(""),
    [products, setProducts] = useState<ProductListRow[]>([]),
    [cart, setCart] = useState<PurchaseDraftLine[]>([]),
    [mode, setMode] = useState<"cash" | "credit" | "partial">("credit"),
    [cash, setCash] = useState(""),
    [source, setSource] = useState("external_cash"),
    [register, setRegister] = useState<RegisterStatus>(),
    [error, setError] = useState(""),
    [camera, setCamera] = useState(false),
    busy = useRef(false);
  const sq = useDebounced(supplierSearch),
    pq = useDebounced(productSearch),
    total = purchaseTotal(cart);
  let cashCents = 0;
  try {
    cashCents = cash ? madToCents(cash) : 0;
  } catch {
    cashCents = 0;
  }
  const credit = purchaseCredit(total, mode, cashCents);
  useEffect(() => {
    request<RegisterStatus>("/register/status").then(setRegister);
  }, []);
  useEffect(() => {
    if (sq)
      request<SupplierListResponse>(
        `/suppliers?search=${encodeURIComponent(sq)}&status=active&pageSize=10`,
      ).then((r) => setSuppliers(r.rows));
  }, [sq]);
  useEffect(() => {
    if (pq)
      request<ProductListResponse>(
        `/products?search=${encodeURIComponent(pq)}&productType=physical_product&status=active&pageSize=10`,
      ).then((r) => setProducts(r.rows));
  }, [pq]);
  const add = (p: ProductListRow) =>
    setCart((rows) =>
      rows.some((r) => r.productId === p.id)
        ? rows.map((row) =>
            row.productId === p.id
              ? { ...row, quantity: row.quantity + 1 }
              : row,
          )
        : [
            ...rows,
            {
              productId: p.id,
              name: p.name,
              quantity: 1,
              purchaseUnitPriceCents: p.purchasePriceCents ?? 0,
            },
          ],
    );
  useScannerContext("purchase-form", "page", ({ code }) =>
    request<BarcodeResolution>(
      `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
    ).then((r) => {
      if (r.product.productType === "physical_product") add(r.product);
    }),
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const f = new FormData(event.currentTarget);
    try {
      const result = await request<{ id: number }>("/purchases", {
        method: "POST",
        json: {
          supplierId: Number(supplierId),
          items: cart.map(
            ({ productId, quantity, purchaseUnitPriceCents }) => ({
              productId,
              quantity,
              purchaseUnitPriceCents,
            }),
          ),
          paymentMode: mode,
          cashPaidCents: mode === "partial" ? cashCents : 0,
          paymentSource: source,
          invoiceNumber: f.get("invoice") || null,
          invoiceDate: f.get("date") || null,
          note: f.get("note") || null,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/purchases/${result.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  };
  const update = (id: number, patch: Partial<PurchaseDraftLine>) =>
    setCart((rows) =>
      rows.map((r) => (r.productId === id ? { ...r, ...patch } : r)),
    );
  const needsRegister = source === "cash_register" && mode !== "credit";
  return (
    <main className="page">
      <h1>Nouvel achat</h1>
      <ErrorBox value={error} />
      {user.permissions.includes("scanner.camera") && (
        <button type="button" onClick={() => setCamera(true)}>
          Scanner avec la caméra
        </button>
      )}
      {camera && (
        <CameraScanner
          close={() => setCamera(false)}
          onScan={(code) =>
            request<BarcodeResolution>(
              `/products/resolve-barcode?code=${encodeURIComponent(code)}`,
            ).then((r) => {
              if (r.product.productType === "physical_product") add(r.product);
            })
          }
        />
      )}
      {needsRegister && !register?.sessionId && (
        <div className="error">
          Ouvrez une caisse pour payer depuis la caisse.
        </div>
      )}
      <div className="pos-grid">
        <section>
          <input
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            placeholder="Rechercher fournisseur"
          />
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choisir</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Produit ou code-barres"
          />
          {products.map((p) => (
            <button type="button" key={p.id} onClick={() => add(p)}>
              {p.name}
            </button>
          ))}
        </section>
        <form onSubmit={submit}>
          <h2>Articles</h2>
          {cart.map((line) => (
            <div className="cart-line" key={line.productId}>
              <span>{line.name}</span>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) =>
                  update(line.productId, { quantity: Number(e.target.value) })
                }
              />
              <input
                type="number"
                min="0"
                value={line.purchaseUnitPriceCents / 100}
                onChange={(e) => {
                  try {
                    update(line.productId, {
                      purchaseUnitPriceCents: madToCents(e.target.value),
                    });
                  } catch {
                    /* retain last valid price */
                  }
                }}
              />
              <button
                type="button"
                onClick={() =>
                  setCart((r) =>
                    r.filter((x) => x.productId !== line.productId),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <p>
            Total : {centsToMad(total)} · crédit : {centsToMad(credit)}
          </p>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="credit">Crédit</option>
            <option value="cash">Comptant</option>
            <option value="partial">Partiel</option>
          </select>
          {mode === "partial" && (
            <input
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="Part payée MAD"
            />
          )}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="external_cash">Espèces externes</option>
            <option value="cash_register">Caisse</option>
          </select>
          <input name="invoice" placeholder="N° facture" />
          <input name="date" type="date" />
          <textarea name="note" placeholder="Note" />
          <button
            disabled={
              !supplierId ||
              !cart.length ||
              credit < 0 ||
              (needsRegister && !register?.sessionId)
            }
          >
            Enregistrer
          </button>
        </form>
      </div>
    </main>
  );
}

export function PurchaseDetails() {
  const { id } = useParams(),
    [data, setData] = useState<PurchaseDetail>(),
    [error, setError] = useState("");
  useEffect(() => {
    request<PurchaseDetail>(`/purchases/${id}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  return (
    <main className="page print-sheet">
      <ErrorBox value={error} />
      {data && (
        <>
          <div className="title">
            <h1>{data.purchaseNumber}</h1>
            <button onClick={() => window.print()}>Imprimer</button>
          </div>
          <p>
            {data.supplierName} · total {centsToMad(data.totalCents)} · payé{" "}
            {centsToMad(data.cashPaidCents)} · crédit{" "}
            {centsToMad(data.creditAmountCents)}
          </p>
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Qté</th>
                <th>Prix achat</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productName}</td>
                  <td>{i.quantity}</td>
                  <td>{centsToMad(i.purchaseUnitPriceCents)}</td>
                  <td>{centsToMad(i.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

export function ExpensesPage() {
  const [search, setSearch] = useState(""),
    [data, setData] = useState<ExpenseListResponse>(),
    [error, setError] = useState("");
  const q = useDebounced(search);
  useEffect(() => {
    request<ExpenseListResponse>(
      `/expenses?search=${encodeURIComponent(q)}&pageSize=50`,
    )
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [q]);
  return (
    <main className="page">
      <div className="title">
        <h1>Dépenses</h1>
        <Link className="button" to="/expenses/new">
          Nouvelle dépense
        </Link>
      </div>
      <ErrorBox value={error} />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Catégorie ou description"
      />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Catégorie</th>
            <th>Description</th>
            <th>Montant</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map((x) => (
            <tr key={x.id}>
              <td>{x.expenseDate.slice(0, 10)}</td>
              <td>{x.category}</td>
              <td>
                <Link to={`/expenses/${x.id}`}>{x.description}</Link>
              </td>
              <td>{centsToMad(x.amountCents)}</td>
              <td>{x.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function ExpenseForm() {
  const navigate = useNavigate(),
    [source, setSource] = useState("cash_register"),
    [register, setRegister] = useState<RegisterStatus>(),
    [error, setError] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    request<RegisterStatus>("/register/status").then(setRegister);
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const f = new FormData(event.currentTarget);
    try {
      const x = await request<Expense>("/expenses", {
        method: "POST",
        json: {
          category: f.get("category"),
          description: f.get("description"),
          amountCents: madToCents(String(f.get("amount"))),
          paymentSource: source,
          expenseDate: f.get("date"),
          note: f.get("note") || null,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/expenses/${x.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  };
  return (
    <main className="page narrow">
      <h1>Nouvelle dépense</h1>
      <ErrorBox value={error} />
      {source === "cash_register" && !register?.sessionId && (
        <div className="error">Ouvrez une caisse.</div>
      )}
      <form onSubmit={submit}>
        <input name="category" placeholder="Catégorie" required />
        <textarea name="description" placeholder="Description" required />
        <input name="amount" placeholder="Montant MAD" required />
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="cash_register">Caisse</option>
          <option value="external_cash">Espèces externes</option>
        </select>
        <input
          name="date"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          required
        />
        <textarea name="note" placeholder="Note" />
        <button disabled={source === "cash_register" && !register?.sessionId}>
          Enregistrer
        </button>
      </form>
    </main>
  );
}

export function ExpenseDetails({ user }: { user: SafeUser }) {
  const { id } = useParams(),
    [data, setData] = useState<Expense>(),
    [error, setError] = useState("");
  useEffect(() => {
    request<Expense>(`/expenses/${id}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  return (
    <main className="page print-sheet">
      <ErrorBox value={error} />
      {data && (
        <>
          <div className="title">
            <h1>{data.description}</h1>
            <div>
              <button onClick={() => window.print()}>Imprimer</button>{" "}
              {allowed(user, "expenses.correct") &&
                data.status === "active" && (
                  <Link to={`/expenses/${id}/correct`}>Corriger</Link>
                )}
            </div>
          </div>
          <p>
            {data.category} · {centsToMad(data.amountCents)} ·{" "}
            {data.paymentSource} · {data.expenseDate.slice(0, 10)}
          </p>
          <p>État : {data.status}</p>
        </>
      )}
    </main>
  );
}
export function ExpenseCorrection() {
  const { id } = useParams(),
    navigate = useNavigate(),
    [error, setError] = useState(""),
    busy = useRef(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      await request(`/expenses/${id}/correct`, {
        method: "POST",
        json: {
          reason: new FormData(e.currentTarget).get("reason"),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/expenses/${id}`);
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      busy.current = false;
    }
  };
  return (
    <main className="page narrow">
      <h1>Corriger la dépense</h1>
      <ErrorBox value={error} />
      <form onSubmit={submit}>
        <textarea name="reason" placeholder="Motif obligatoire" required />
        <button>Confirmer la correction</button>
      </form>
    </main>
  );
}

export function ReturnsPage() {
  const [search, setSearch] = useState(""),
    [data, setData] = useState<ReturnListResponse>(),
    [error, setError] = useState("");
  const q = useDebounced(search);
  useEffect(() => {
    request<ReturnListResponse>(
      `/returns?search=${encodeURIComponent(q)}&pageSize=50`,
    )
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [q]);
  return (
    <main className="page">
      <div className="title">
        <h1>Retours</h1>
        <Link className="button" to="/returns/new">
          Nouveau retour
        </Link>
      </div>
      <ErrorBox value={error} />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Retour ou vente"
      />
      <table>
        <thead>
          <tr>
            <th>Retour</th>
            <th>Vente</th>
            <th>Total</th>
            <th>Crédit</th>
            <th>Espèces</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map((x) => (
            <tr key={x.id}>
              <td>
                <Link to={`/returns/${x.id}`}>{x.returnNumber}</Link>
              </td>
              <td>{x.saleNumber}</td>
              <td>{centsToMad(x.totalCents)}</td>
              <td>{centsToMad(x.debtReductionCents)}</td>
              <td>{centsToMad(x.cashRefundCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function ReturnForm() {
  const [params] = useSearchParams(),
    { id: routeId } = useParams(),
    navigate = useNavigate(),
    [saleId, setSaleId] = useState(routeId ?? params.get("saleId") ?? ""),
    [items, setItems] = useState<ReturnableItem[]>([]),
    [remainingCredit, setRemainingCredit] = useState(0),
    [quantities, setQuantities] = useState<Record<number, number>>({}),
    [selectedUnits, setSelectedUnits] = useState<Record<number, string[]>>({}),
    [unitInputs, setUnitInputs] = useState<Record<number, string>>({}),
    [restock, setRestock] = useState<Record<number, boolean>>({}),
    [register, setRegister] = useState<RegisterStatus>(),
    [error, setError] = useState(""),
    busy = useRef(false);
  const total = items.reduce(
      (sum, item) => sum + (quantities[item.id] ?? 0) * item.unitPriceCents,
      0,
    ),
    allocation = refundAllocation(total, remainingCredit);
  const load = () =>
    request<{ items: ReturnableItem[]; remainingCreditCents: number }>(
      `/sales/${saleId}/returnable-items`,
    )
      .then((x) => {
        setItems(x.items);
        setRemainingCredit(x.remainingCreditCents);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    request<RegisterStatus>("/register/status").then(setRegister);
    if (routeId || params.get("saleId")) load(); /* initial route only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const addReturnUnit = (item: ReturnableItem) => {
    const barcode = (unitInputs[item.id] ?? "").trim();
    if (!item.unitBarcodes?.includes(barcode)) {
      setError("Cette unité ne fait pas partie de cette vente.");
      return;
    }
    const current = selectedUnits[item.id] ?? [];
    if (current.includes(barcode)) {
      setError("Cette unité a déjà été ajoutée au retour.");
      return;
    }
    const next = [...current, barcode];
    setSelectedUnits({ ...selectedUnits, [item.id]: next });
    setQuantities({ ...quantities, [item.id]: next.length });
    setUnitInputs({ ...unitInputs, [item.id]: "" });
    setError("");
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      const x = await request<{ id: number }>("/returns", {
        method: "POST",
        json: {
          saleId: Number(saleId),
          items: items
            .filter((i) => (quantities[i.id] ?? 0) > 0)
            .map((i) => ({
              saleItemId: i.id,
              quantity: quantities[i.id],
              unitBarcodes: i.unitBarcodes?.length
                ? selectedUnits[i.id] ?? []
                : undefined,
              restock:
                i.productType === "physical_product" && Boolean(restock[i.id]),
              condition: restock[i.id] ? "restocké" : "non restocké",
            })),
          reason: new FormData(e.currentTarget).get("reason"),
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/returns/${x.id}`);
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      busy.current = false;
    }
  };
  return (
    <main className="page">
      <h1>Nouveau retour</h1>
      <ErrorBox value={error} />
      <div className="filters">
        <input
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
          placeholder="ID de vente"
        />
        <button onClick={load}>Charger</button>
      </div>
      <form onSubmit={submit}>
        {items.map((i) => (
          <div className="cart-line" key={i.id}>
            <span>
              {i.productName} · restant {i.returnableQuantity}
            </span>
            <input
              type="number"
              min="0"
              max={i.returnableQuantity}
              value={quantities[i.id] ?? 0}
              disabled={Boolean(i.unitBarcodes?.length)}
              onChange={(e) =>
                setQuantities({ ...quantities, [i.id]: Number(e.target.value) })
              }
            />
            {i.unitBarcodes?.length ? (
              <div className="serialized-return-units">
                <div
                  className="scanner"
                >
                  <label>
                    Code unitaire vendu
                    <input
                      value={unitInputs[i.id] ?? ""}
                      onChange={(event) =>
                        setUnitInputs({ ...unitInputs, [i.id]: event.target.value })
                      }
                      placeholder="Scanner le code exact"
                      autoComplete="off"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addReturnUnit(i);
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => addReturnUnit(i)}>Ajouter</button>
                </div>
                {(selectedUnits[i.id] ?? []).map((barcode) => (
                  <span className="badge" key={barcode}>
                    {barcode}{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        const next = (selectedUnits[i.id] ?? []).filter((x) => x !== barcode);
                        setSelectedUnits({ ...selectedUnits, [i.id]: next });
                        setQuantities({ ...quantities, [i.id]: next.length });
                      }}
                    >×</button>
                  </span>
                ))}
              </div>
            ) : null}
            {i.productType === "physical_product" ? (
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(restock[i.id])}
                  onChange={(e) =>
                    setRestock({ ...restock, [i.id]: e.target.checked })
                  }
                />{" "}
                Restocker
              </label>
            ) : (
              <span>Service (sans stock)</span>
            )}
            <b>{centsToMad((quantities[i.id] ?? 0) * i.unitPriceCents)}</b>
          </div>
        ))}
        <p>
          Estimation : crédit {centsToMad(allocation.debtReductionCents)} ·
          espèces {centsToMad(allocation.cashRefundCents)}
        </p>
        {allocation.cashRefundCents > 0 && !register?.sessionId && (
          <div className="error">
            Ouvrez une caisse pour la part en espèces.
          </div>
        )}
        <textarea name="reason" placeholder="Motif" required />
        <button
          disabled={
            !total || (allocation.cashRefundCents > 0 && !register?.sessionId)
          }
        >
          Confirmer
        </button>
      </form>
    </main>
  );
}

export function ReturnDetails() {
  const { id } = useParams(),
    [data, setData] = useState<ReturnDetail>(),
    [error, setError] = useState("");
  useEffect(() => {
    request<ReturnDetail>(`/returns/${id}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  return (
    <main className="page print-sheet">
      <ErrorBox value={error} />
      {data && (
        <>
          <div className="title">
            <h1>{data.returnNumber}</h1>
            <button onClick={() => window.print()}>Imprimer</button>
          </div>
          <p>
            Vente {data.saleNumber} · total {centsToMad(data.totalCents)} ·
            crédit {centsToMad(data.debtReductionCents)} · espèces{" "}
            {centsToMad(data.cashRefundCents)}
          </p>
          <p>Motif : {data.reason}</p>
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Qté</th>
                <th>Montant</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productName}</td>
                  <td>{i.quantity}</td>
                  <td>{centsToMad(i.amountCents)}</td>
                  <td>{i.restock ? "Restocké" : "Non restocké"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
