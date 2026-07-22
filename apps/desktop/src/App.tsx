import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, User } from "./api";
import {
  CartLine,
  cartTotal,
  denominationTotal,
  money,
  ScannerBuffer,
  toCents,
} from "./lib";
import "./App.css";
type Bootstrap = {
  needsOnboarding: boolean;
  user: User | null;
  databasePath: string;
};
type Product = {
  id: number;
  name: string;
  productType: string;
  sku: string;
  manufacturerBarcode: string;
  internalBarcode: string;
  qrIdentifier: string;
  sellingPriceCents: number;
  purchasePriceCents: number;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
  trackStock: boolean;
  categoryName: string;
};
type Category = {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  productCount: number;
};
type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  debtCents: number;
  isActive: boolean;
};
const roleName: Record<string, string> = {
  global_admin: "Administrateur global",
  manager: "Gérant",
  cashier: "Caissier",
  stock_worker: "Responsable stock",
};
const Input = ({
  label,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
  <label>
    <span>{label}</span>
    <input {...p} />
  </label>
);
const ErrorBox = ({ message }: { message: string }) =>
  message ? <div className="alert">{message}</div> : null;
function useAsync() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const state = useRef({ busy, error, setError, run });
  state.current.busy = busy;
  state.current.error = error;
  state.current.setError = setError;
  state.current.run = run;
  return state.current;
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const { error, run } = useAsync();
  useEffect(() => {
    void run(() => api.call<Bootstrap>("bootstrap")).then(
      (x) => x && setBoot(x),
    );
  }, [run]);
  if (!boot)
    return (
      <div className="splash">
        <div className="spinner" />
        Initialisation sécurisée…
        <ErrorBox message={error} />
      </div>
    );
  if (boot.needsOnboarding)
    return (
      <Onboarding
        done={(u) => setBoot({ ...boot, needsOnboarding: false, user: u })}
      />
    );
  if (!boot.user) return <Login done={(u) => setBoot({ ...boot, user: u })} />;
  if (boot.user.mustChangePassword)
    return (
      <ChangePassword
        user={boot.user}
        done={(u) => setBoot({ ...boot, user: u })}
        logout={async () => {
          await api.call("logout");
          setBoot({ ...boot, user: null });
        }}
      />
    );
  return (
    <BrowserRouter>
      <Shell
        user={boot.user}
        databasePath={boot.databasePath}
        logout={async () => {
          await api.call("logout");
          setBoot({ ...boot, user: null });
        }}
      />
    </BrowserRouter>
  );
}
function Onboarding({ done }: { done: (u: User) => void }) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      a.setError("Les mots de passe ne correspondent pas");
      return;
    }
    void a
      .run(() =>
        api.call<User>("create_owner", {
          input: {
            shopName: f.get("shopName"),
            fullName: f.get("fullName"),
            username: f.get("username"),
            email: f.get("email") || null,
            password: f.get("password"),
            barcodePrefix: f.get("prefix"),
          },
        }),
      )
      .then((x) => x && done(x));
  };
  return (
    <main className="auth">
      <section>
        <div className="brand">M</div>
        <h1>Bienvenue dans Double Library POS</h1>
        <p>
          Créez le propriétaire du magasin. Vos données resteront sur cet
          ordinateur.
        </p>
        <ErrorBox message={a.error} />
        <form onSubmit={submit}>
          <Input label="Nom du magasin" name="shopName" required autoFocus />
          <Input label="Nom complet du propriétaire" name="fullName" required />
          <div className="two">
            <Input
              label="Nom d’utilisateur"
              name="username"
              minLength={3}
              required
            />
            <Input label="E-mail (facultatif)" name="email" type="email" />
          </div>
          <div className="two">
            <Input
              label="Mot de passe fort"
              name="password"
              type="password"
              minLength={8}
              required
            />
            <Input
              label="Confirmation"
              name="confirm"
              type="password"
              required
            />
          </div>
          <Input
            label="Préfixe codes-barres"
            name="prefix"
            defaultValue="MKT"
            pattern="[A-Za-z0-9]{2,8}"
            required
          />
          <button disabled={a.busy}>
            {a.busy ? "Création…" : "Créer mon espace"}
          </button>
        </form>
      </section>
    </main>
  );
}
function Login({ done }: { done: (u: User) => void }) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call<User>("login", {
          input: { login: f.get("login"), password: f.get("password") },
        }),
      )
      .then((x) => x && done(x));
  };
  return (
    <main className="auth">
      <section className="login">
        <div className="brand">M</div>
        <h1>Connexion</h1>
        <p>Accédez à votre espace de travail</p>
        <ErrorBox message={a.error} />
        <form onSubmit={submit}>
          <Input
            label="Nom d’utilisateur ou e-mail"
            name="login"
            required
            autoFocus
          />
          <Input
            label="Mot de passe"
            name="password"
            type="password"
            required
          />
          <button disabled={a.busy}>Se connecter</button>
        </form>
      </section>
    </main>
  );
}
const nav = [
  ["dashboard", "Tableau de bord", "dashboard.view"],
  ["pos", "Caisse", "pos.use"],
  ["products", "Produits", "products.view"],
  ["categories", "Catégories", "categories.manage"],
  ["stock", "Stock", "stock.view"],
  ["customers", "Clients", "customers.view"],
  ["suppliers", "Fournisseurs", "suppliers.view"],
  ["purchases", "Achats", "purchases.view"],
  ["expenses", "Dépenses", "expenses.view"],
  ["employees", "Employés", "workers.view"],
  ["reports", "Rapports", "reports.sales"],
  ["register", "Caisses", "register.open"],
  ["settings", "Paramètres", "settings.manage"],
  ["backup", "Sauvegarde", "backup.manage"],
] as const;
function Shell({
  user,
  databasePath,
  logout,
}: {
  user: User;
  databasePath: string;
  logout: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location]);
  return (
    <div className="app">
      <aside className={menu ? "open" : ""}>
        <div className="side-brand">
          <b>M</b>
          <span>
            Double Library POS<small>Gestion locale</small>
          </span>
        </div>
        <nav>
          {nav
            .filter((x) => user.permissions.includes(x[2]))
            .map((x) => (
              <NavLink key={x[0]} to={"/" + x[0]}>
                <i>{x[1][0]}</i>
                {x[1]}
              </NavLink>
            ))}
        </nav>
        <div className="profile">
          <div>
            {user.fullName}
            <small>{roleName[user.role]}</small>
          </div>
          <button className="ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </aside>
      <div className="content">
        <header>
          <button className="mobile" onClick={() => setMenu(!menu)}>
            ☰
          </button>
          <div>
            <strong>
              {nav.find((x) => location.pathname.startsWith("/" + x[0]))?.[1] ??
                "Double Library POS"}
            </strong>
            <small>
              {" "}
              {new Intl.DateTimeFormat("fr-MA", { dateStyle: "full" }).format(
                new Date(),
              )}
            </small>
          </div>
          <span className="online">● Hors ligne · données locales</span>
        </header>
        <main>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <Allowed u={user} p="dashboard.view">
                  <Dashboard />
                </Allowed>
              }
            />
            <Route
              path="/products"
              element={
                <Allowed u={user} p="products.view">
                  <Products user={user} />
                </Allowed>
              }
            />
            <Route
              path="/categories"
              element={
                <Allowed u={user} p="categories.manage">
                  <Categories />
                </Allowed>
              }
            />
            <Route
              path="/stock"
              element={
                <Allowed u={user} p="stock.view">
                  <Stock user={user} />
                </Allowed>
              }
            />
            <Route
              path="/pos"
              element={
                <Allowed u={user} p="pos.use">
                  <Pos />
                </Allowed>
              }
            />
            <Route
              path="/customers"
              element={
                <Allowed u={user} p="customers.view">
                  <Customers user={user} />
                </Allowed>
              }
            />
            <Route
              path="/suppliers"
              element={
                <Allowed u={user} p="suppliers.view">
                  <Suppliers user={user} />
                </Allowed>
              }
            />
            <Route
              path="/purchases"
              element={
                <Allowed u={user} p="purchases.view">
                  <Purchases />
                </Allowed>
              }
            />
            <Route
              path="/expenses"
              element={
                <Allowed u={user} p="expenses.view">
                  <ExpenseManager />
                </Allowed>
              }
            />
            <Route
              path="/sales/:id/return"
              element={
                <Allowed u={user} p="sales.return">
                  <ReturnSale />
                </Allowed>
              }
            />
            <Route
              path="/employees"
              element={
                <Allowed u={user} p="workers.view">
                  <Employees user={user} />
                </Allowed>
              }
            />
            <Route
              path="/reports"
              element={
                <Allowed u={user} p="reports.sales">
                  <ReportsHub user={user} />
                </Allowed>
              }
            />
            <Route
              path="/reports/:kind"
              element={<ReportsPage user={user} />}
            />
            <Route
              path="/register"
              element={
                <Allowed u={user} p="register.open">
                  <RegisterWithDenominations />
                </Allowed>
              }
            />
            <Route
              path="/settings"
              element={
                <Allowed u={user} p="settings.manage">
                  <Settings />
                </Allowed>
              }
            />
            <Route
              path="/backup"
              element={
                <Allowed u={user} p="backup.manage">
                  <Backup path={databasePath} />
                </Allowed>
              }
            />
            <Route
              path="*"
              element={
                <Navigate
                  to={
                    "/" + nav.find((x) => user.permissions.includes(x[2]))![0]
                  }
                  replace
                />
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Allowed({
  u,
  p,
  children,
}: {
  u: User;
  p: string;
  children: React.ReactNode;
}) {
  return u.permissions.includes(p) ? (
    children
  ) : (
    <Navigate to="/dashboard" replace />
  );
}
function Page({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </>
  );
}
function Dashboard() {
  const [data, setData] = useState<Record<string, number> | null>(null),
    a = useAsync();
  useEffect(() => {
    void a
      .run(() => api.call<Record<string, number>>("dashboard"))
      .then((x) => x && setData(x));
  }, [a]);
  if (!data) return <div className="card">Chargement…</div>;
  const cards = [
    ["Ventes aujourd’hui", money(data.salesToday)],
    ["Espèces encaissées", money(data.cashToday)],
    ["Dette clients", money(data.customerDebt)],
    ["Dette fournisseurs", money(data.supplierDebt)],
    ["Dépenses aujourd’hui", money(data.expensesToday)],
    ["Stock valorisé", money(data.stockValue)],
    ["Tickets", String(data.saleCount)],
    ["Stock faible", String(data.lowStock)],
  ];
  return (
    <Page
      title="Bonjour 👋"
      sub="Voici l’activité réelle de votre magasin aujourd’hui."
    >
      <div className="metrics">
        {cards.map((x, i) => (
          <article key={x[0]}>
            <span className={"dot c" + (i % 4)} />
            <small>{x[0]}</small>
            <strong>{x[1]}</strong>
          </article>
        ))}
      </div>
      <div className="grid2">
        <section className="card">
          <h2>État opérationnel</h2>
          <div className="status">
            <span>Caisse</span>
            <b>{data.openRegister ? "Ouverte" : "Fermée"}</b>
          </div>
          <div className="status">
            <span>Mode</span>
            <b>100 % hors ligne</b>
          </div>
        </section>
        <section className="card">
          <h2>Alertes</h2>
          <p>
            {data.lowStock
              ? `${data.lowStock} produit(s) nécessitent votre attention.`
              : "Tous les niveaux de stock sont corrects."}
          </p>
        </section>
      </div>
    </Page>
  );
}
function Products({ user }: { user: User }) {
  const [items, setItems] = useState<Product[]>([]),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Product | null | undefined>(),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<Product[]>("list_products", {
            search: search || null,
            categoryId: null,
            lowStock: false,
            page: 1,
          }),
        )
        .then((x) => x && setItems(x)),
    [search, a],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <Page
      title="Produits et services"
      sub="Catalogue, prix et identifiants internes"
      action={
        user.permissions.includes("products.create") ? (
          <button onClick={() => setEdit(null)}>+ Nouveau produit</button>
        ) : null
      }
    >
      <ErrorBox message={a.error} />
      <div className="toolbar">
        <input
          placeholder="Nom, SKU, code-barres ou QR…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{items.length} résultat(s)</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Catégorie</th>
              <th>Code</th>
              <th>Prix</th>
              <th>Stock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>
                    {p.productType === "service"
                      ? "Service"
                      : "Produit physique"}{" "}
                    · {p.sku || "Sans SKU"}
                  </small>
                </td>
                <td>{p.categoryName}</td>
                <td>
                  <code>{p.manufacturerBarcode || p.internalBarcode}</code>
                </td>
                <td>{money(p.sellingPriceCents)}</td>
                <td>
                  <span
                    className={
                      p.trackStock && p.currentStock <= p.minimumStock
                        ? "pill danger"
                        : "pill"
                    }
                  >
                    {p.trackStock ? p.currentStock : "—"}
                  </span>
                </td>
                <td>
                  {user.permissions.includes("products.edit") && (
                    <button className="link" onClick={() => setEdit(p)}>
                      Modifier
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="Aucun produit trouvé" />}
      </div>
      {edit !== undefined && (
        <ProductDialog
          product={edit}
          close={() => setEdit(undefined)}
          saved={() => {
            setEdit(undefined);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function ProductDialog({
  product,
  close,
  saved,
}: {
  product: Product | null;
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      pc = (n: string) => toCents(String(f.get(n))) ?? -1;
    void a
      .run(() =>
        api.call("save_product", {
          input: {
            id: product?.id ?? null,
            categoryId: null,
            name: f.get("name"),
            description: null,
            productType: f.get("type"),
            sku: f.get("sku") || null,
            manufacturerBarcode: f.get("barcode") || null,
            purchasePriceCents: pc("purchase"),
            sellingPriceCents: pc("selling"),
            wholesalePriceCents: 0,
            wholesaleMinQuantity: 1,
            minimumStock: Number(f.get("minimum")),
            unit: f.get("unit"),
            shelfLocation: f.get("shelf") || null,
            trackStock: f.get("type") === "physical_product",
          },
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal
      title={product ? "Modifier le produit" : "Nouveau produit"}
      close={close}
    >
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input
          label="Nom"
          name="name"
          defaultValue={product?.name}
          required
          autoFocus
        />
        <label>
          <span>Type</span>
          <select
            name="type"
            defaultValue={product?.productType ?? "physical_product"}
          >
            <option value="physical_product">Produit physique</option>
            <option value="service">Service</option>
          </select>
        </label>
        <div className="two">
          <Input label="SKU" name="sku" defaultValue={product?.sku} />
          <Input
            label="Code fabricant"
            name="barcode"
            defaultValue={product?.manufacturerBarcode}
          />
        </div>
        <div className="two">
          <Input
            label="Prix d’achat (MAD)"
            name="purchase"
            defaultValue={((product?.purchasePriceCents ?? 0) / 100).toFixed(2)}
            required
          />
          <Input
            label="Prix de vente (MAD)"
            name="selling"
            defaultValue={((product?.sellingPriceCents ?? 0) / 100).toFixed(2)}
            required
          />
        </div>
        <div className="two">
          <Input
            label="Stock minimum"
            name="minimum"
            type="number"
            min="0"
            defaultValue={product?.minimumStock ?? 5}
          />
          <Input label="Unité" name="unit" defaultValue="unité" required />
        </div>
        <Input label="Emplacement" name="shelf" />
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button disabled={a.busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
function Categories() {
  const [items, setItems] = useState<Category[]>([]),
    [edit, setEdit] = useState<Category | null | undefined>(),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() => api.call<Category[]>("list_categories"))
        .then((x) => x && setItems(x)),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = (x: Category) =>
    void a
      .run(() => api.call("toggle_category", { id: x.id, active: !x.isActive }))
      .then((y) => {
        if (y !== undefined) void load();
      });
  return (
    <Page
      title="Catégories"
      sub="Organisez votre catalogue"
      action={
        <button onClick={() => setEdit(null)}>+ Nouvelle catégorie</button>
      }
    >
      <ErrorBox message={a.error} />
      <div className="cards">
        {items.map((x) => (
          <article className="card" key={x.id}>
            <h3>{x.name}</h3>
            <p>{x.description || "Aucune description"}</p>
            <small>{x.productCount} produit(s)</small>
            <div className="actions">
              <button className="link" onClick={() => setEdit(x)}>
                Modifier
              </button>
              <button className="secondary" onClick={() => toggle(x)}>
                {x.isActive ? "Désactiver" : "Activer"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {edit !== undefined && (
        <CategoryDialog
          value={edit}
          close={() => setEdit(undefined)}
          saved={() => {
            setEdit(undefined);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function CategoryDialog({
  value,
  close,
  saved,
}: {
  value: Category | null;
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("save_category", {
          id: value?.id ?? null,
          name: f.get("name"),
          description: f.get("description") || null,
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal
      title={value ? "Modifier la catégorie" : "Nouvelle catégorie"}
      close={close}
    >
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input
          label="Nom"
          name="name"
          defaultValue={value?.name}
          required
          autoFocus
        />
        <label>
          <span>Description</span>
          <textarea name="description" defaultValue={value?.description} />
        </label>
        <div className="actions">
          <button className="secondary" type="button" onClick={close}>
            Annuler
          </button>
          <button>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
function Stock({ user }: { user: User }) {
  const [items, setItems] = useState<Product[]>([]),
    [selected, setSelected] = useState<Product | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<Product[]>("list_products", {
            search: null,
            categoryId: null,
            lowStock: false,
            page: 1,
          }),
        )
        .then((x) => x && setItems(x.filter((p) => p.trackStock))),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Page
      title="État du stock"
      sub="Chaque modification produit un mouvement traçable"
    >
      <ErrorBox message={a.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Emplacement</th>
              <th>Disponible</th>
              <th>Seuil</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>{p.internalBarcode}</small>
                </td>
                <td>{p.categoryName}</td>
                <td>{p.currentStock}</td>
                <td>{p.minimumStock}</td>
                <td>
                  {user.permissions.includes("stock.adjust") && (
                    <button className="link" onClick={() => setSelected(p)}>
                      Ajuster
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <StockDialog
          product={selected}
          close={() => setSelected(null)}
          saved={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function StockDialog({
  product,
  close,
  saved,
}: {
  product: Product;
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("adjust_stock", {
          productId: product.id,
          quantity: Number(f.get("quantity")),
          movementType: f.get("type"),
          reason: f.get("reason"),
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal title={`Ajuster · ${product.name}`} close={close}>
      <p>
        Stock actuel : <b>{product.currentStock}</b>
      </p>
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <label>
          <span>Opération</span>
          <select name="type">
            <option value="stock_in">Entrée</option>
            <option value="stock_out">Sortie</option>
            <option value="damaged">Endommagé</option>
            <option value="lost">Perdu</option>
            <option value="inventory_correction">Correction inventaire</option>
          </select>
        </label>
        <Input
          label="Quantité"
          name="quantity"
          type="number"
          min="1"
          required
        />
        <Input label="Motif obligatoire" name="reason" required />
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button>Valider</button>
        </div>
      </form>
    </Modal>
  );
}
function Pos() {
  const [products, setProducts] = useState<Product[]>([]),
    [cart, setCart] = useState<CartLine[]>([]),
    [query, setQuery] = useState(""),
    [customer, setCustomer] = useState<Customer | null>(null),
    [mode, setMode] = useState<"cash" | "credit" | "partial">("cash"),
    [cash, setCash] = useState(""),
    [receipt, setReceipt] = useState<{ saleNumber: string } | null>(null),
    a = useAsync(),
    input = useRef<HTMLInputElement>(null),
    scanner = useMemo(() => new ScannerBuffer(), []);
  const search = useCallback(
    (q: string) =>
      a
        .run(() =>
          api.call<Product[]>("list_products", {
            search: q || null,
            categoryId: null,
            lowStock: false,
            page: 1,
          }),
        )
        .then((x) => x && setProducts(x.filter((p) => p.isActive))),
    [a],
  );
  useEffect(() => {
    void search("");
  }, [search]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        input.current?.focus();
      }
      const code = scanner.feed(e.key);
      if (code) {
        e.preventDefault();
        void search(code);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scanner, search]);
  const add = (p: Product) =>
    setCart((c) => {
      const old = c.find((x) => x.productId === p.id);
      return old
        ? c.map((x) =>
            x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x,
          )
        : [
            ...c,
            {
              productId: p.id,
              name: p.name,
              quantity: 1,
              unitPriceCents: p.sellingPriceCents,
              discountCents: 0,
              stock: p.currentStock,
              productType: p.productType,
            },
          ];
    });
  const total = cartTotal(cart),
    cashC = toCents(cash) || 0,
    credit =
      mode === "cash"
        ? 0
        : mode === "credit"
          ? total
          : Math.max(0, total - cashC);
  const confirm = () => {
    if (!confirmDialog(`Confirmer la vente de ${money(total)} ?`)) return;
    void a
      .run(() =>
        api.call<{ saleNumber: string }>("create_sale", {
          input: {
            customerId: customer?.id ?? null,
            items: cart.map((x) => ({
              productId: x.productId,
              quantity: x.quantity,
              unitPriceCents: x.unitPriceCents,
              discountCents: x.discountCents,
            })),
            discountCents: 0,
            cashPaidCents:
              mode === "credit" ? 0 : mode === "cash" ? total : cashC,
            creditAmountCents: credit,
            notes: null,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      )
      .then((x) => {
        if (x) {
          setReceipt(x);
          setCart([]);
          setCash("");
        }
      });
  };
  return (
    <Page title="Point de vente" sub="F2 scanner · F10 confirmer">
      <ErrorBox message={a.error} />
      {receipt && (
        <div className="success">
          Vente {receipt.saleNumber} enregistrée.{" "}
          <button className="link" onClick={() => window.print()}>
            Imprimer
          </button>
        </div>
      )}
      <div className="pos">
        <section>
          <input
            ref={input}
            className="scan"
            placeholder="Scanner ou rechercher un produit…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void search(e.target.value);
            }}
            autoFocus
          />
          <div className="product-grid">
            {products.slice(0, 18).map((p) => (
              <button key={p.id} onClick={() => add(p)}>
                <b>{p.name}</b>
                <span>{money(p.sellingPriceCents)}</span>
                <small>
                  {p.productType === "service"
                    ? "Service"
                    : `Stock ${p.currentStock}`}
                </small>
              </button>
            ))}
          </div>
        </section>
        <aside className="cart">
          <h2>
            Panier <small>{cart.length} ligne(s)</small>
          </h2>
          {cart.map((x) => (
            <div className="cart-line" key={x.productId}>
              <div>
                <b>{x.name}</b>
                <small>
                  {money(x.unitPriceCents)} × {x.quantity}
                </small>
              </div>
              <div>
                <button
                  onClick={() =>
                    setCart((c) =>
                      c.map((y) =>
                        y.productId === x.productId
                          ? { ...y, quantity: Math.max(1, y.quantity - 1) }
                          : y,
                      ),
                    )
                  }
                >
                  −
                </button>
                <b>{x.quantity}</b>
                <button
                  onClick={() =>
                    setCart((c) =>
                      c.map((y) =>
                        y.productId === x.productId
                          ? { ...y, quantity: y.quantity + 1 }
                          : y,
                      ),
                    )
                  }
                >
                  +
                </button>
                <button
                  className="remove"
                  onClick={() =>
                    setCart((c) => c.filter((y) => y.productId !== x.productId))
                  }
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {!cart.length && <Empty text="Scannez un article pour commencer" />}
          <div className="total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <CustomerPicker value={customer} set={setCustomer} />
          <div className="segments">
            <button
              className={mode === "cash" ? "active" : ""}
              onClick={() => setMode("cash")}
            >
              Comptant
            </button>
            <button
              className={mode === "credit" ? "active" : ""}
              onClick={() => setMode("credit")}
            >
              Crédit
            </button>
            <button
              className={mode === "partial" ? "active" : ""}
              onClick={() => setMode("partial")}
            >
              Partiel
            </button>
          </div>
          {mode === "partial" && (
            <Input
              label="Espèces reçues (MAD)"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          )}
          <button
            className="confirm"
            disabled={!cart.length || a.busy || (credit > 0 && !customer)}
            onClick={confirm}
          >
            Confirmer · {money(total)}
          </button>
        </aside>
      </div>
    </Page>
  );
}
function CustomerPicker({
  value,
  set,
}: {
  value: Customer | null;
  set: (x: Customer | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Customer[]>([]);
  const load = () =>
    api.call<Customer[]>("list_customers", { search: null }).then(setItems);
  return (
    <div>
      <button
        className="customer"
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        {value ? `Client : ${value.name}` : "Sélectionner un client"}
      </button>
      {open && (
        <div className="picker">
          {items.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                set(x);
                setOpen(false);
              }}
            >
              {x.name}
              <small>Dette {money(x.debtCents)}</small>
            </button>
          ))}
          <button
            onClick={() => {
              set(null);
              setOpen(false);
            }}
          >
            Aucun client
          </button>
        </div>
      )}
    </div>
  );
}
function Customers({ user }: { user: User }) {
  const [items, setItems] = useState<Customer[]>([]),
    [add, setAdd] = useState(false),
    [pay, setPay] = useState<Customer | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() => api.call<Customer[]>("list_customers", { search: null }))
        .then((x) => x && setItems(x)),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Page
      title="Clients"
      sub="Suivi des comptes et crédits"
      action={
        user.permissions.includes("customers.create") ? (
          <button onClick={() => setAdd(true)}>+ Nouveau client</button>
        ) : null
      }
    >
      <ErrorBox message={a.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Contact</th>
              <th>Dette actuelle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.name}</b>
                </td>
                <td>{x.phone || "—"}</td>
                <td className={x.debtCents ? "red" : ""}>
                  {money(x.debtCents)}
                </td>
                <td>
                  {x.debtCents > 0 &&
                    user.permissions.includes("customers.credit.payment") && (
                      <button className="link" onClick={() => setPay(x)}>
                        Encaisser
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {add && (
        <CustomerDialog
          close={() => setAdd(false)}
          saved={() => {
            setAdd(false);
            void load();
          }}
        />
      )}
      {pay && (
        <PaymentDialog
          customer={pay}
          close={() => setPay(null)}
          saved={() => {
            setPay(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function CustomerDialog({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("save_customer", {
          id: null,
          fullName: f.get("name"),
          phone: f.get("phone") || null,
          email: f.get("email") || null,
          address: null,
          notes: null,
          creditLimitCents: toCents(String(f.get("limit"))) || 0,
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal title="Nouveau client" close={close}>
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input label="Nom complet" name="name" required />
        <Input label="Téléphone" name="phone" />
        <Input label="E-mail" name="email" type="email" />
        <Input label="Plafond de crédit (MAD)" name="limit" defaultValue="0" />
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button>Créer</button>
        </div>
      </form>
    </Modal>
  );
}
function PaymentDialog({
  customer,
  close,
  saved,
}: {
  customer: Customer;
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("customer_payment", {
          customerId: customer.id,
          amountCents: toCents(String(f.get("amount"))) || 0,
          notes: f.get("notes") || null,
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal title={`Règlement · ${customer.name}`} close={close}>
      <p>
        Dette : <b>{money(customer.debtCents)}</b>
      </p>
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input label="Montant reçu (MAD)" name="amount" required autoFocus />
        <Input label="Note" name="notes" />
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button>Encaisser</button>
        </div>
      </form>
    </Modal>
  );
}
function Register() {
  const [reg, setReg] = useState<{
      id: number;
      openingAmountCents: number;
      openedAt: string;
    } | null>(null),
    [report, setReport] = useState<Record<string, number> | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() => api.call<typeof reg>("current_register"))
        .then((x) => setReg(x ?? null)),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const openReg = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("open_register", {
          openingAmountCents: toCents(String(f.get("amount"))) || 0,
          note: f.get("note") || null,
        }),
      )
      .then((x) => {
        if (x !== undefined) void load();
      });
  };
  const closeReg = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call<Record<string, number>>("close_register", {
          actualAmountCents: toCents(String(f.get("amount"))) || 0,
          differenceReason: f.get("reason") || null,
        }),
      )
      .then((x) => {
        if (x) {
          setReport(x);
          setReg(null);
        }
      });
  };
  return (
    <Page
      title="Caisse enregistreuse"
      sub="Ouverture, comptage et clôture auditable"
    >
      <ErrorBox message={a.error} />
      {report && (
        <div className="card print">
          <h2>Rapport de clôture #{report.id}</h2>
          <p>Attendu : {money(report.expectedCents)}</p>
          <p>Compté : {money(report.actualCents)}</p>
          <p>Écart : {money(report.differenceCents)}</p>
          <button onClick={() => window.print()}>Imprimer</button>
        </div>
      )}
      {!reg ? (
        <section className="card narrow">
          <h2>Ouvrir ma caisse</h2>
          <form onSubmit={openReg}>
            <Input
              label="Fond de caisse (MAD)"
              name="amount"
              defaultValue="0.00"
              required
            />
            <Input label="Note facultative" name="note" />
            <button>Ouvrir la caisse</button>
          </form>
        </section>
      ) : (
        <section className="card narrow">
          <span className="badge">Caisse ouverte</span>
          <h2>Session #{reg.id}</h2>
          <p>
            Ouverte le {new Date(reg.openedAt + "Z").toLocaleString("fr-MA")}
          </p>
          <p>
            Fond initial : <b>{money(reg.openingAmountCents)}</b>
          </p>
          <hr />
          <h3>Clôturer</h3>
          <form onSubmit={closeReg}>
            <Input
              label="Montant réellement compté (MAD)"
              name="amount"
              required
            />
            <Input label="Motif de l’écart (si nécessaire)" name="reason" />
            <button>Calculer et clôturer</button>
          </form>
        </section>
      )}
    </Page>
  );
}
function Settings() {
  const [value, setValue] = useState<Record<string, unknown> | null>(null),
    a = useAsync();
  useEffect(() => {
    void a
      .run(() => api.call<Record<string, unknown>>("get_settings"))
      .then((x) => x && setValue(x));
  }, [a]);
  if (!value) return <div>Chargement…</div>;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a.run(() =>
      api.call("save_settings", {
        value: {
          ...value,
          shopName: f.get("shop"),
          phone: f.get("phone"),
          address: f.get("address"),
          receiptFooter: f.get("footer"),
          lowStockDefault: Number(f.get("low")),
          receiptWidth: Number(f.get("width")),
          automaticBackup: f.get("auto") === "on",
          backupRetention: Number(f.get("retention")),
        },
      }),
    );
  };
  return (
    <Page title="Paramètres" sub="Identité du magasin, reçus et sauvegardes">
      <section className="card narrow">
        <ErrorBox message={a.error} />
        <form onSubmit={submit}>
          <Input
            label="Nom du magasin"
            name="shop"
            defaultValue={String(value.shopName)}
            required
          />
          <Input
            label="Téléphone"
            name="phone"
            defaultValue={String(value.phone)}
          />
          <Input
            label="Adresse"
            name="address"
            defaultValue={String(value.address)}
          />
          <Input
            label="Pied de reçu"
            name="footer"
            defaultValue={String(value.receiptFooter)}
          />
          <div className="two">
            <Input
              label="Seuil stock par défaut"
              name="low"
              type="number"
              defaultValue={Number(value.lowStockDefault)}
            />
            <label>
              <span>Largeur reçu</span>
              <select name="width" defaultValue={Number(value.receiptWidth)}>
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
                <option value="210">A4</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              name="auto"
              defaultChecked={Boolean(value.automaticBackup)}
            />{" "}
            Sauvegarde automatique quotidienne
          </label>
          <Input
            label="Nombre de sauvegardes conservées"
            name="retention"
            type="number"
            min="1"
            defaultValue={Number(value.backupRetention)}
          />
          <button disabled={a.busy}>Enregistrer</button>
        </form>
      </section>
    </Page>
  );
}
const reportDefinitions = [
  ["sales", "Ventes", "reports.sales"],
  ["profit", "Bénéfices", "reports.profit"],
  ["stock", "Stock", "reports.stock"],
  ["customers", "Crédits clients", "reports.customers"],
  ["suppliers", "Dettes fournisseurs", "reports.suppliers"],
  ["expenses", "Dépenses", "reports.expenses"],
  ["workers", "Activité employés", "reports.workers"],
  ["daily_closing", "Clôtures quotidiennes", "reports.daily_closing"],
] as const;
function ReportsHub({ user }: { user: User }) {
  return (
    <Page title="Rapports" sub="Indicateurs calculés depuis la base SQLite">
      <div className="cards">
        {reportDefinitions
          .filter((x) => user.permissions.includes(x[2]))
          .map((x) => (
            <article className="card" key={x[0]}>
              <h3>{x[1]}</h3>
              <p>Données réelles, filtres et export sécurisé.</p>
              <NavLink className="link" to={`/reports/${x[0]}`}>
                Ouvrir le rapport →
              </NavLink>
            </article>
          ))}
      </div>
    </Page>
  );
}
type ReportResponse = {
  kind: string;
  start: string;
  end: string;
  summary: Record<string, number>;
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};
function presetDates(preset: string) {
  const end = new Date(),
    start = new Date(end);
  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "7") {
    start.setDate(start.getDate() - 6);
  } else if (preset === "30") {
    start.setDate(start.getDate() - 29);
  } else if (preset === "month") {
    start.setDate(1);
  } else if (preset === "previous") {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
  }
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}
function ReportsPage({ user }: { user: User }) {
  const { kind = "sales" } = useParams(),
    definition = reportDefinitions.find((x) => x[0] === kind),
    permission = definition?.[2];
  const [range, setRange] = useState(() => presetDates("30")),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<ReportResponse | null>(null),
    [message, setMessage] = useState(""),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<ReportResponse>("run_report", {
            kind,
            start: range.start,
            end: range.end,
            search: search || null,
            page,
            pageSize: 25,
          }),
        )
        .then((x) => x && setData(x)),
    [a, kind, range, search, page],
  );
  useEffect(() => {
    if (permission && user.permissions.includes(permission)) void load();
  }, [load, permission, user.permissions]);
  const exportData = async () => {
    const exportKind = ["profit", "daily_closing"].includes(kind)
      ? "sales"
      : kind === "stock"
        ? "stock"
        : kind;
    const destination = await save({
      defaultPath: `${kind}_${range.start}_${range.end}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!destination) return;
    void a
      .run(() =>
        api.call<{ rowCount: number }>("export_csv", {
          kind: exportKind,
          destination,
          start: range.start,
          end: range.end,
        }),
      )
      .then((x) => x && setMessage(`${x.rowCount} ligne(s) exportée(s)`));
  };
  if (!definition || !permission || !user.permissions.includes(permission))
    return <Navigate to="/reports" replace />;
  return (
    <Page
      title={definition[1]}
      sub={`Période du ${range.start} au ${range.end}`}
      action={
        <button onClick={exportData} disabled={a.busy}>
          Exporter CSV
        </button>
      }
    >
      <ErrorBox message={a.error} />
      {message && <div className="success">{message}</div>}
      <div className="toolbar">
        <select
          onChange={(e) => {
            setRange(presetDates(e.target.value));
            setPage(1);
          }}
          defaultValue="30"
        >
          <option value="today">Aujourd’hui</option>
          <option value="yesterday">Hier</option>
          <option value="7">7 derniers jours</option>
          <option value="30">30 derniers jours</option>
          <option value="month">Mois en cours</option>
          <option value="previous">Mois précédent</option>
        </select>
        <input
          type="date"
          value={range.start}
          onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
        />
        <input
          type="date"
          value={range.end}
          onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
        />
        <input
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <button onClick={() => void load()}>Actualiser</button>
      </div>
      {!data ? (
        <div className="card">Chargement…</div>
      ) : (
        <>
          <div className="metrics">
            {Object.entries(data.summary)
              .slice(0, 8)
              .map(([k, v]) => (
                <article key={k}>
                  <small>{reportLabel(k)}</small>
                  <strong>
                    {k.toLowerCase().includes("cents") ? money(v) : v}
                  </strong>
                </article>
              ))}
          </div>
          {data.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {Object.keys(data.rows[0]).map((k) => (
                      <th key={k}>{reportLabel(k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      {Object.entries(row).map(([k, v]) => (
                        <td key={k}>
                          {k.toLowerCase().includes("cents") &&
                          typeof v === "number"
                            ? money(v)
                            : String(v ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Aucune ligne pour cette période" />
          )}
          <div className="actions">
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </button>
            <span>
              Page {data.page} / {Math.max(1, data.totalPages)}
            </span>
            <button
              className="secondary"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </button>
          </div>
        </>
      )}
    </Page>
  );
}
function reportLabel(key: string) {
  const labels: Record<string, string> = {
    grossCents: "Ventes brutes",
    returnedCents: "Retours",
    cashCents: "Espèces",
    creditCents: "Crédit",
    count: "Nombre",
    revenueCents: "Revenu net",
    costCents: "Coût",
    grossProfitCents: "Marge brute",
    expensesCents: "Dépenses",
    netCents: "Résultat estimé",
    margin: "Marge %",
    units: "Unités",
    valueCents: "Valeur stock",
    sellingValueCents: "Valeur potentielle",
    low: "Stock faible",
    out: "Rupture",
    withDebt: "Avec dette",
    debtCents: "Dette totale",
    correctionCents: "Corrections",
  };
  return labels[key] ?? key.replace(/([A-Z])/g, " $1");
}

function ChangePassword({
  user,
  done,
  logout,
}: {
  user: User;
  done: (u: User) => void;
  logout: () => void;
}) {
  const a = useAsync(),
    [sent, setSent] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sent) return;
    const f = new FormData(e.currentTarget);
    if (f.get("new") !== f.get("confirm")) {
      a.setError("Les mots de passe ne correspondent pas");
      return;
    }
    setSent(true);
    void a
      .run(() =>
        api.call<User>("change_current_password", {
          currentPassword: f.get("current"),
          newPassword: f.get("new"),
        }),
      )
      .then((x) => {
        if (x) done(x);
        else setSent(false);
      });
  };
  return (
    <main className="auth">
      <section className="login">
        <div className="brand">M</div>
        <h1>Changer le mot de passe</h1>
        <p>
          {user.fullName}, définissez votre mot de passe personnel avant de
          continuer.
        </p>
        <ErrorBox message={a.error} />
        <form onSubmit={submit}>
          <Input
            label="Mot de passe temporaire"
            name="current"
            type="password"
            required
          />
          <Input
            label="Nouveau mot de passe"
            name="new"
            type="password"
            minLength={8}
            required
          />
          <Input label="Confirmation" name="confirm" type="password" required />
          <button disabled={sent}>Enregistrer</button>
          <button type="button" className="secondary" onClick={logout}>
            Déconnexion
          </button>
        </form>
      </section>
    </main>
  );
}
type Worker = {
  id: number;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};
function Employees({ user }: { user: User }) {
  const [items, setItems] = useState<Worker[]>([]),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Worker | null | undefined>(),
    [temporary, setTemporary] = useState(""),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<Worker[]>("list_workers", {
            search: search || null,
            role: null,
            active: null,
            page: 1,
          }),
        )
        .then((x) => x && setItems(x)),
    [a, search],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  const reset = (x: Worker) => {
    if (!confirm(`Réinitialiser le mot de passe de ${x.fullName} ?`)) return;
    void a
      .run(() =>
        api.call<string>("reset_worker_password", { id: x.id, password: null }),
      )
      .then((p) => p && setTemporary(p));
  };
  return (
    <Page
      title="Employés"
      sub="Comptes locaux, rôles et activité"
      action={
        user.permissions.includes("workers.create") ? (
          <button onClick={() => setEdit(null)}>+ Nouvel employé</button>
        ) : null
      }
    >
      <ErrorBox message={a.error} />
      {temporary && (
        <div className="success">
          Mot de passe temporaire (affiché une seule fois) :{" "}
          <code>{temporary}</code>
          <button className="link" onClick={() => setTemporary("")}>
            Masquer
          </button>
        </div>
      )}
      <div className="toolbar">
        <input
          placeholder="Nom, identifiant ou e-mail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employé</th>
              <th>Rôle</th>
              <th>Dernière connexion</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.fullName}</b>
                  <small>
                    {x.username} · {x.email || "sans e-mail"}
                  </small>
                </td>
                <td>
                  <span className="pill">{roleName[x.role]}</span>
                </td>
                <td>{x.lastLoginAt || "Jamais"}</td>
                <td>
                  {x.isActive ? "Actif" : "Inactif"}
                  {x.mustChangePassword && <small>Changement requis</small>}
                </td>
                <td>
                  <button className="link" onClick={() => setEdit(x)}>
                    Modifier
                  </button>
                  {user.permissions.includes("workers.reset_password") && (
                    <button className="link" onClick={() => reset(x)}>
                      Réinitialiser
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit !== undefined && (
        <WorkerForm
          value={edit}
          actor={user}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function WorkerForm({
  value,
  actor,
  close,
  done,
}: {
  value: Worker | null;
  actor: User;
  close: () => void;
  done: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!value && f.get("password") !== f.get("confirm")) {
      a.setError("Les mots de passe ne correspondent pas");
      return;
    }
    void a
      .run(() =>
        api.call("save_worker", {
          input: {
            id: value?.id ?? null,
            fullName: f.get("name"),
            username: f.get("username"),
            email: f.get("email") || null,
            phone: f.get("phone") || null,
            role: f.get("role"),
            isActive: f.get("active") === "on",
            temporaryPassword: value ? null : f.get("password"),
          },
        }),
      )
      .then((x) => x !== undefined && done());
  };
  return (
    <Modal
      title={value ? "Modifier l’employé" : "Nouvel employé"}
      close={close}
    >
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input
          label="Nom complet"
          name="name"
          defaultValue={value?.fullName}
          required
        />
        <Input
          label="Identifiant"
          name="username"
          defaultValue={value?.username}
          required
        />
        <div className="two">
          <Input
            label="E-mail"
            name="email"
            type="email"
            defaultValue={value?.email}
          />
          <Input label="Téléphone" name="phone" defaultValue={value?.phone} />
        </div>
        <label>
          <span>Rôle</span>
          <select name="role" defaultValue={value?.role ?? "cashier"}>
            {actor.role === "global_admin" && (
              <option value="global_admin">Administrateur global</option>
            )}
            <option value="manager">Gérant</option>
            <option value="cashier">Caissier</option>
            <option value="stock_worker">Responsable stock</option>
          </select>
        </label>
        {!value && (
          <>
            <Input
              label="Mot de passe temporaire"
              name="password"
              type="password"
              required
            />
            <Input
              label="Confirmation"
              name="confirm"
              type="password"
              required
            />
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={value?.isActive ?? true}
          />{" "}
          Compte actif
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

type ExpenseRow = {
  id: number;
  category: string;
  description: string;
  amountCents: number;
  expenseDate: string;
  status: string;
  registerId: number;
  worker: string;
  notes: string;
  correctionOfId: number | null;
};
function ExpenseManager() {
  const [items, setItems] = useState<ExpenseRow[]>([]),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1),
    [correct, setCorrect] = useState<ExpenseRow | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<ExpenseRow[]>("list_expenses", {
            search: search || null,
            category: category || null,
            dateFrom: null,
            dateTo: null,
            page,
          }),
        )
        .then((x) => x && setItems(x)),
    [a, search, category, page],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Page
      title="Dépenses"
      sub="Historique financier conservé et corrections auditables"
    >
      <ErrorBox message={a.error} />
      <div className="toolbar">
        <input
          placeholder="Rechercher une description…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toutes catégories</option>
          {[
            "Loyer",
            "Électricité",
            "Eau",
            "Internet",
            "Salaires",
            "Transport",
            "Maintenance",
            "Fournitures du magasin",
            "Autre",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Dépense</th>
              <th>Employé</th>
              <th>Caisse</th>
              <th>Montant</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>{x.expenseDate}</td>
                <td>
                  <b>{x.description}</b>
                  <small>{x.category}</small>
                </td>
                <td>{x.worker}</td>
                <td>#{x.registerId}</td>
                <td>{money(x.amountCents)}</td>
                <td>
                  <span
                    className={x.status === "active" ? "pill" : "pill danger"}
                  >
                    {x.status === "active"
                      ? "Active"
                      : x.status === "reversed"
                        ? "Annulée"
                        : "Correction"}
                  </span>
                </td>
                <td>
                  {x.status === "active" && (
                    <button className="link" onClick={() => setCorrect(x)}>
                      Corriger
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="Aucune dépense" />}
      </div>
      <div className="actions">
        <button
          className="secondary"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Précédent
        </button>
        <span>Page {page}</span>
        <button
          className="secondary"
          disabled={items.length < 30}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>
      {correct && (
        <ExpenseCorrection
          value={correct}
          close={() => setCorrect(null)}
          done={() => {
            setCorrect(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function ExpenseCorrection({
  value,
  close,
  done,
}: {
  value: ExpenseRow;
  close: () => void;
  done: () => void;
}) {
  const [reason, setReason] = useState(""),
    [sent, setSent] = useState(false),
    a = useAsync();
  const submit = () => {
    if (!reason.trim() || sent) return;
    setSent(true);
    void a
      .run(() => api.call("correct_expense", { expenseId: value.id, reason }))
      .then((x) => {
        if (x !== undefined) done();
        else setSent(false);
      });
  };
  return (
    <Modal title="Corriger la dépense" close={close}>
      <p>
        <b>{value.description}</b>
        <br />
        {money(value.amountCents)} · {value.expenseDate}
      </p>
      <p>L’original sera conservé et une écriture compensatoire sera créée.</p>
      <ErrorBox message={a.error} />
      <label>
        <span>Motif obligatoire</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button className="secondary" onClick={close}>
          Annuler
        </button>
        <button disabled={!reason.trim() || sent} onClick={submit}>
          Confirmer la correction
        </button>
      </div>
    </Modal>
  );
}
const madDenominations = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
function RegisterWithDenominations() {
  const [reg, setReg] = useState<{
      id: number;
      openingAmountCents: number;
      openedAt: string;
    } | null>(null),
    [counts, setCounts] = useState<Record<number, number>>({}),
    [reason, setReason] = useState(""),
    [report, setReport] = useState<Record<string, number> | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() => api.call<typeof reg>("current_register"))
        .then((x) => setReg(x ?? null)),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const actual = denominationTotal(counts);
  if (!reg) return <Register />;
  const close = () => {
    if (!window.confirm("Confirmer la clôture définitive de la caisse ?"))
      return;
    void a
      .run(() =>
        api.call<Record<string, number>>("close_register_with_denominations", {
          lines: madDenominations.map((d) => ({
            denominationCents: d,
            quantity: counts[d] || 0,
          })),
          differenceReason: reason || null,
          note: null,
        }),
      )
      .then((x) => {
        if (x) {
          setReport(x);
          setReg(null);
        }
      });
  };
  if (report)
    return (
      <Page title="Rapport de clôture">
        <section className="card print">
          <h2>Caisse #{report.id}</h2>
          <p>Attendu : {money(report.expectedCents)}</p>
          <p>Compté : {money(report.actualCents)}</p>
          <p>Écart : {money(report.differenceCents)}</p>
          <button onClick={() => window.print()}>Imprimer</button>
        </section>
      </Page>
    );
  return (
    <Page title="Clôture de caisse" sub="Comptage des espèces en MAD">
      <ErrorBox message={a.error} />
      <section className="card narrow">
        <p>
          Fond initial : <b>{money(reg.openingAmountCents)}</b>
        </p>
        {madDenominations.map((d) => (
          <div className="status" key={d}>
            <span>{money(d)}</span>
            <input
              aria-label={`Quantité ${money(d)}`}
              type="number"
              min="0"
              step="1"
              value={counts[d] || 0}
              onChange={(e) =>
                setCounts((c) => ({
                  ...c,
                  [d]: Math.max(0, Math.floor(Number(e.target.value))),
                }))
              }
            />
            <b>{money(d * (counts[d] || 0))}</b>
          </div>
        ))}
        <div className="total">
          <span>Total compté</span>
          <strong>{money(actual)}</strong>
        </div>
        <Input
          label="Motif de l’écart (requis si nécessaire)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button onClick={close} disabled={a.busy}>
          Clôturer la caisse
        </button>
      </section>
    </Page>
  );
}
type ReturnData = {
  sale: {
    id: number;
    saleNumber: string;
    createdAt: string;
    paymentType: string;
    cashPaidCents: number;
    creditAmountCents: number;
    status: string;
    customer: string;
    cashier: string;
  };
  items: Array<{
    id: number;
    productId: number;
    name: string;
    productType: string;
    quantity: number;
    returnedQuantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  history: Array<{
    returnNumber: string;
    createdAt: string;
    totalCents: number;
    debtReductionCents: number;
    cashRefundCents: number;
    reason: string;
  }>;
};
function ReturnSale() {
  const { id } = useParams(),
    [data, setData] = useState<ReturnData | null>(null),
    [quantities, setQuantities] = useState<Record<number, number>>({}),
    [restock, setRestock] = useState<Record<number, boolean>>({}),
    [reason, setReason] = useState(""),
    [sent, setSent] = useState(false),
    [receipt, setReceipt] = useState<Record<string, number | string> | null>(
      null,
    ),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() =>
          api.call<ReturnData>("sale_for_return", { saleId: Number(id) }),
        )
        .then((x) => x && setData(x)),
    [a, id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return (
      <div className="card">
        Chargement…
        <ErrorBox message={a.error} />
      </div>
    );
  const total = data.items.reduce(
    (s, x) =>
      s + Math.floor((x.lineTotalCents * (quantities[x.id] || 0)) / x.quantity),
    0,
  );
  const priorDebt = data.history.reduce((s, x) => s + x.debtReductionCents, 0),
    debt = Math.min(
      total,
      Math.max(0, data.sale.creditAmountCents - priorDebt),
    ),
    cash = Math.max(0, total - debt);
  const submit = () => {
    if (sent || !reason.trim() || total <= 0) return;
    setSent(true);
    void a
      .run(() =>
        api.call<Record<string, number | string>>("create_return", {
          input: {
            saleId: data.sale.id,
            reason,
            idempotencyKey: crypto.randomUUID(),
            items: data.items
              .filter((x) => (quantities[x.id] || 0) > 0)
              .map((x) => ({
                saleItemId: x.id,
                quantity: quantities[x.id],
                restock:
                  x.productType === "physical_product" && !!restock[x.id],
                condition: restock[x.id] ? "restockable" : "damaged",
              })),
          },
        }),
      )
      .then((x) => {
        if (x) {
          setReceipt(x);
          void load();
        } else setSent(false);
      });
  };
  return (
    <Page
      title={`Retour · ${data.sale.saleNumber}`}
      sub={`${data.sale.customer || "Client comptoir"} · ${data.sale.paymentType}`}
    >
      <ErrorBox message={a.error} />
      {receipt && (
        <div className="success print">
          Retour {String(receipt.returnNumber)} ·{" "}
          {money(Number(receipt.totalCents))}{" "}
          <button onClick={() => window.print()}>Imprimer</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Article</th>
              <th>Vendu</th>
              <th>Déjà retourné</th>
              <th>Quantité</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.name}</b>
                  <small>{money(x.unitPriceCents)}</small>
                </td>
                <td>{x.quantity}</td>
                <td>{x.returnedQuantity}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max={x.quantity - x.returnedQuantity}
                    value={quantities[x.id] || 0}
                    onChange={(e) =>
                      setQuantities((q) => ({
                        ...q,
                        [x.id]: Math.min(
                          x.quantity - x.returnedQuantity,
                          Math.max(0, Number(e.target.value)),
                        ),
                      }))
                    }
                  />
                </td>
                <td>
                  {x.productType === "physical_product" ? (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!restock[x.id]}
                        onChange={(e) =>
                          setRestock((r) => ({
                            ...r,
                            [x.id]: e.target.checked,
                          }))
                        }
                      />{" "}
                      Remettre en stock
                    </label>
                  ) : (
                    "Service"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card narrow">
        <p>
          Valeur : <b>{money(total)}</b>
        </p>
        <p>
          Réduction dette : <b>{money(debt)}</b>
        </p>
        <p>
          Remboursement espèces : <b>{money(cash)}</b>
        </p>
        <Input
          label="Motif obligatoire"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          disabled={sent || !reason.trim() || total <= 0}
          onClick={submit}
        >
          Enregistrer le retour
        </button>
      </section>
      <section className="card">
        <h2>Historique</h2>
        {data.history.map((x) => (
          <p key={x.returnNumber}>
            <b>{x.returnNumber}</b> · {money(x.totalCents)} · {x.reason}
          </p>
        ))}
        {!data.history.length && <Empty text="Aucun retour" />}
      </section>
    </Page>
  );
}

type Supplier = {
  id: number;
  name: string;
  phone: string;
  email: string;
  debtCents: number;
  isActive: boolean;
};
function Suppliers({ user }: { user: User }) {
  const [items, setItems] = useState<Supplier[]>([]),
    [dialog, setDialog] = useState(false),
    [pay, setPay] = useState<Supplier | null>(null),
    a = useAsync();
  const load = useCallback(
    () =>
      a
        .run(() => api.call<Supplier[]>("list_suppliers", { search: null }))
        .then((x) => x && setItems(x)),
    [a],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Page
      title="Fournisseurs"
      sub="Coordonnées, dettes et règlements"
      action={
        user.permissions.includes("suppliers.manage") ? (
          <button onClick={() => setDialog(true)}>+ Nouveau fournisseur</button>
        ) : null
      }
    >
      <ErrorBox message={a.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fournisseur</th>
              <th>Contact</th>
              <th>Dette</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>
                  <b>{x.name}</b>
                </td>
                <td>{x.phone || x.email || "—"}</td>
                <td>{money(x.debtCents)}</td>
                <td>
                  {x.debtCents > 0 &&
                    user.permissions.includes("suppliers.payment") && (
                      <button className="link" onClick={() => setPay(x)}>
                        Payer
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && (
        <SupplierForm
          close={() => setDialog(false)}
          saved={() => {
            setDialog(false);
            void load();
          }}
        />
      )}
      {pay && (
        <SupplierPay
          supplier={pay}
          close={() => setPay(null)}
          saved={() => {
            setPay(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}
function SupplierForm({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("save_supplier", {
          input: {
            id: null,
            name: f.get("name"),
            contactName: f.get("contact") || null,
            phone: f.get("phone") || null,
            email: f.get("email") || null,
            address: f.get("address") || null,
            notes: f.get("notes") || null,
          },
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal title="Nouveau fournisseur" close={close}>
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input label="Raison sociale" name="name" required />
        <Input label="Contact" name="contact" />
        <div className="two">
          <Input label="Téléphone" name="phone" />
          <Input label="E-mail" name="email" type="email" />
        </div>
        <Input label="Adresse" name="address" />
        <Input label="Notes" name="notes" />
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Annuler
          </button>
          <button>Créer</button>
        </div>
      </form>
    </Modal>
  );
}
function SupplierPay({
  supplier,
  close,
  saved,
}: {
  supplier: Supplier;
  close: () => void;
  saved: () => void;
}) {
  const a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call("supplier_payment", {
          supplierId: supplier.id,
          amountCents: toCents(String(f.get("amount"))) || 0,
          notes: f.get("notes") || null,
        }),
      )
      .then((x) => x !== undefined && saved());
  };
  return (
    <Modal title={`Paiement · ${supplier.name}`} close={close}>
      <p>
        Dette actuelle : <b>{money(supplier.debtCents)}</b>
      </p>
      <ErrorBox message={a.error} />
      <form onSubmit={submit}>
        <Input label="Montant comptant (MAD)" name="amount" required />
        <Input label="Note" name="notes" />
        <button>Payer depuis la caisse</button>
      </form>
    </Modal>
  );
}
function Purchases() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [lines, setLines] = useState([{ productId: 0, quantity: 1, price: "" }]),
    [message, setMessage] = useState(""),
    a = useAsync();
  useEffect(() => {
    void Promise.all([
      api.call<Supplier[]>("list_suppliers", { search: null }),
      api.call<Product[]>("list_products", {
        search: null,
        categoryId: null,
        lowStock: false,
        page: 1,
      }),
    ]).then(([s, p]) => {
      setSuppliers(s);
      setProducts(p.filter((x) => x.productType === "physical_product"));
    });
  }, []);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call<number>("create_purchase", {
          input: {
            supplierId: Number(f.get("supplier")),
            paidCents: toCents(String(f.get("paid"))) || 0,
            reference: f.get("reference") || null,
            notes: f.get("notes") || null,
            items: lines.map((x) => ({
              productId: x.productId,
              quantity: x.quantity,
              unitPurchasePriceCents: toCents(x.price) || 0,
            })),
          },
        }),
      )
      .then((x) => x && setMessage(`Achat #${x} enregistré`));
  };
  return (
    <Page
      title="Nouvel achat"
      sub="Réception multi-lignes et dette fournisseur"
    >
      <section className="card">
        <ErrorBox message={a.error} />
        {message && <div className="success">{message}</div>}
        <form onSubmit={submit}>
          <label>
            <span>Fournisseur</span>
            <select name="supplier" required>
              <option value="">Choisir…</option>
              {suppliers.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {lines.map((x, i) => (
            <div className="two" key={i}>
              <label>
                <span>Produit</span>
                <select
                  value={x.productId}
                  onChange={(e) =>
                    setLines((v) =>
                      v.map((y, j) =>
                        j === i
                          ? { ...y, productId: Number(e.target.value) }
                          : y,
                      ),
                    )
                  }
                >
                  <option value="0">Choisir…</option>
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                label="Quantité"
                type="number"
                min="1"
                value={x.quantity}
                onChange={(e) =>
                  setLines((v) =>
                    v.map((y, j) =>
                      j === i ? { ...y, quantity: Number(e.target.value) } : y,
                    ),
                  )
                }
              />
              <Input
                label="Prix achat MAD"
                value={x.price}
                onChange={(e) =>
                  setLines((v) =>
                    v.map((y, j) =>
                      j === i ? { ...y, price: e.target.value } : y,
                    ),
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setLines((v) => [...v, { productId: 0, quantity: 1, price: "" }])
            }
          >
            + Ajouter une ligne
          </button>
          <div className="two">
            <Input label="Payé comptant MAD" name="paid" defaultValue="0" />
            <Input label="Référence" name="reference" />
          </div>
          <Input label="Notes" name="notes" />
          <button>Enregistrer l’achat</button>
        </form>
      </section>
    </Page>
  );
}
export function Expenses() {
  const [msg, setMsg] = useState(""),
    a = useAsync();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void a
      .run(() =>
        api.call<number>("create_expense", {
          input: {
            category: f.get("category"),
            description: f.get("description"),
            amountCents: toCents(String(f.get("amount"))) || 0,
            expenseDate: f.get("date"),
            notes: f.get("notes") || null,
          },
        }),
      )
      .then((x) => x && setMsg(`Dépense #${x} enregistrée`));
  };
  return (
    <Page title="Dépenses" sub="Décaissements traçables">
      <section className="card narrow">
        <ErrorBox message={a.error} />
        {msg && <div className="success">{msg}</div>}
        <form onSubmit={submit}>
          <label>
            <span>Catégorie</span>
            <select name="category">
              {[
                "Loyer",
                "Électricité",
                "Eau",
                "Internet",
                "Salaires",
                "Transport",
                "Maintenance",
                "Fournitures du magasin",
                "Autre",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <Input label="Description" name="description" required />
          <Input label="Montant MAD" name="amount" required />
          <Input
            label="Date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
          <Input label="Notes" name="notes" />
          <button>Enregistrer la dépense</button>
        </form>
      </section>
    </Page>
  );
}
function Backup({ path }: { path: string }) {
  const [msg, setMsg] = useState(""),
    a = useAsync();
  const backup = async () => {
    const dest = await save({
      defaultPath: `maktaba-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      filters: [{ name: "SQLite", extensions: ["sqlite3"] }],
    });
    if (dest)
      void a
        .run(() => api.call<string>("backup_database", { destination: dest }))
        .then((x) => x && setMsg(`Sauvegarde créée : ${x}`));
  };
  const restore = async () => {
    const src = await open({
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["sqlite3", "db"] }],
    });
    if (
      typeof src === "string" &&
      confirmDialog(
        "Restaurer cette sauvegarde ? Une copie de sécurité sera créée.",
      )
    )
      void a
        .run(() => api.call("restore_database", { source: src }))
        .then(
          (x) =>
            x !== undefined &&
            setMsg("Restauration terminée. Redémarrez l’application."),
        );
  };
  return (
    <Page
      title="Sauvegarde et restauration"
      sub="Copie complète et vérifiée de votre base SQLite"
    >
      <ErrorBox message={a.error} />
      {msg && <div className="success">{msg}</div>}
      <div className="grid2">
        <section className="card">
          <h2>Créer une sauvegarde</h2>
          <p>
            SQLite effectue un checkpoint WAL puis vérifie l’intégrité du
            fichier.
          </p>
          <button onClick={backup} disabled={a.busy}>
            Choisir la destination
          </button>
        </section>
        <section className="card">
          <h2>Restaurer</h2>
          <p>
            Le fichier et ses tables obligatoires seront validés avant
            remplacement.
          </p>
          <button className="danger-button" onClick={restore} disabled={a.busy}>
            Choisir une sauvegarde
          </button>
        </section>
      </div>
      <div className="card">
        <small>Base de données active</small>
        <code className="path">{path}</code>
      </div>
    </Page>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [close]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <b>∅</b>
      <p>{text}</p>
    </div>
  );
}
function confirmDialog(message: string) {
  return window.confirm(message);
}
