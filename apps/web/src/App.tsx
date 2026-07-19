import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { RegisterStatus, SafeUser } from "@maktaba/shared-types";
import { request, AuthResponse, ApiFailure } from "./api";
import { initializeAuth, resetAuthInitialization } from "./auth-bootstrap";
import { singleFlight } from "./single-flight";
import { checkConnection, isTauriRuntime, refreshOfflineCache } from "./offline-pos";
const Dashboard = lazy(() => import("./Dashboard"));
const phase2 = () => import("./Phase2");
const CategoriesPage = lazy(() =>
  phase2().then((m) => ({ default: m.CategoriesPage })),
);
const CategoryForm = lazy(() =>
  phase2().then((m) => ({ default: m.CategoryForm })),
);
const ProductsPage = lazy(() =>
  phase2().then((m) => ({ default: m.ProductsPage })),
);
const ProductForm = lazy(() =>
  phase2().then((m) => ({ default: m.ProductForm })),
);
const ProductDetails = lazy(() =>
  phase2().then((m) => ({ default: m.ProductDetails })),
);
const StockPage = lazy(() => phase2().then((m) => ({ default: m.StockPage })));
const StockAdjust = lazy(() =>
  phase2().then((m) => ({ default: m.StockAdjust })),
);
const StockMovements = lazy(() =>
  phase2().then((m) => ({ default: m.StockMovements })),
);
const phase3 = () => import("./Phase3");
const RegisterPage = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterPage })),
);
const RegisterOpen = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterOpen })),
);
const RegisterClose = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterClose })),
);
const RegisterSessions = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterSessions })),
);
const RegisterSessionDetails = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterSessionDetails })),
);
const RegisterMovements = lazy(() =>
  phase3().then((m) => ({ default: m.RegisterMovements })),
);
const CustomersPage = lazy(() =>
  phase3().then((m) => ({ default: m.CustomersPage })),
);
const CustomerForm = lazy(() =>
  phase3().then((m) => ({ default: m.CustomerForm })),
);
const CustomerDetails = lazy(() =>
  phase3().then((m) => ({ default: m.CustomerDetails })),
);
const CustomerPayment = lazy(() =>
  phase3().then((m) => ({ default: m.CustomerPayment })),
);
const PosPage = lazy(() => phase3().then((m) => ({ default: m.PosPage })));
const SalesPage = lazy(() => phase3().then((m) => ({ default: m.SalesPage })));
const SaleDetails = lazy(() =>
  phase3().then((m) => ({ default: m.SaleDetails })),
);
const OfflineQueuePage = lazy(() =>
  phase3().then((m) => ({ default: m.OfflineQueuePage })),
);
const phase4 = () => import("./Phase4");
const SuppliersPage = lazy(() =>
    phase4().then((m) => ({ default: m.SuppliersPage })),
  ),
  SupplierForm = lazy(() =>
    phase4().then((m) => ({ default: m.SupplierForm })),
  ),
  SupplierDetails = lazy(() =>
    phase4().then((m) => ({ default: m.SupplierDetails })),
  ),
  SupplierPayment = lazy(() =>
    phase4().then((m) => ({ default: m.SupplierPayment })),
  ),
  PurchasesPage = lazy(() =>
    phase4().then((m) => ({ default: m.PurchasesPage })),
  ),
  PurchaseForm = lazy(() =>
    phase4().then((m) => ({ default: m.PurchaseForm })),
  ),
  PurchaseDetails = lazy(() =>
    phase4().then((m) => ({ default: m.PurchaseDetails })),
  ),
  ExpensesPage = lazy(() =>
    phase4().then((m) => ({ default: m.ExpensesPage })),
  ),
  ExpenseForm = lazy(() => phase4().then((m) => ({ default: m.ExpenseForm }))),
  ExpenseDetails = lazy(() =>
    phase4().then((m) => ({ default: m.ExpenseDetails })),
  ),
  ExpenseCorrection = lazy(() =>
    phase4().then((m) => ({ default: m.ExpenseCorrection })),
  ),
  ReturnsPage = lazy(() => phase4().then((m) => ({ default: m.ReturnsPage }))),
  ReturnForm = lazy(() => phase4().then((m) => ({ default: m.ReturnForm }))),
  ReturnDetails = lazy(() =>
    phase4().then((m) => ({ default: m.ReturnDetails })),
  );
const phase5 = () => import("./Phase5"),
  EmployeesPage = lazy(() =>
    phase5().then((m) => ({ default: m.EmployeesPage })),
  ),
  EmployeeForm = lazy(() =>
    phase5().then((m) => ({ default: m.EmployeeForm })),
  ),
  EmployeeDetails = lazy(() =>
    phase5().then((m) => ({ default: m.EmployeeDetails })),
  ),
  PasswordReset = lazy(() =>
    phase5().then((m) => ({ default: m.PasswordReset })),
  ),
  AuditPage = lazy(() => phase5().then((m) => ({ default: m.AuditPage }))),
  ReportsHub = lazy(() => phase5().then((m) => ({ default: m.ReportsHub }))),
  ReportPage = lazy(() => phase5().then((m) => ({ default: m.ReportPage }))),
  SettingsPage = lazy(() =>
    phase5().then((m) => ({ default: m.SettingsPage })),
  ),
  BackupsPage = lazy(() => phase5().then((m) => ({ default: m.BackupsPage }))),
  ProductLabel = lazy(() =>
    phase5().then((m) => ({ default: m.ProductLabel })),
  );
function field(f: FormData, n: string) {
  return String(f.get(n) ?? "");
}
export default function App() {
  const [user, setUser] = useState<SafeUser | null | undefined>(),
    [needsOwner, setNeedsOwner] = useState(false),
    [offline, setOffline] = useState(false),
    [loggingOut, setLoggingOut] = useState(false),
    [logoutError, setLogoutError] = useState("");
  const logoutAction = useRef<() => Promise<void>>(undefined);
  const refresh = useCallback(async () => {
    try {
      const result = await initializeAuth();
      setNeedsOwner(result.needsOwner);
      setUser(result.user);
      setOffline(false);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        setOffline(false);
        setUser(null);
      } else {
        setOffline(true);
        setUser((current) => (current === undefined ? null : current));
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const online = () => void refresh(),
      off = () => void checkConnection().then((state) => setOffline(state === "offline"));
    const timer = window.setInterval(off, 30_000);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    const expired = () => {
      resetAuthInitialization();
      setUser(null);
    };
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      window.removeEventListener("session-expired", expired);
      window.clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!user || offline || !isTauriRuntime()) return;
    void request<RegisterStatus>("/register/status")
      .then((register) => refreshOfflineCache({ isOpen: register.isOpen, sessionId: register.sessionId }))
      .catch(() => undefined);
  }, [offline, user]);
  if (user === undefined)
    return <div className="center">Initialisation sécurisée…</div>;
  const retry = () => {
    resetAuthInitialization();
    setUser(undefined);
    void refresh();
  };
  logoutAction.current ??= singleFlight(async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await request<void>("/auth/logout", { method: "POST" });
      resetAuthInitialization();
      window.history.replaceState({}, "", "/login");
      setUser(null);
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Déconnexion impossible.",
      );
    } finally {
      setLoggingOut(false);
    }
  });
  const logout = () => logoutAction.current!();
  if (offline && (user === undefined || user === null))
    return <Offline retry={retry} />;
  if (needsOwner)
    return (
      <Onboarding
        done={(u) => {
          setNeedsOwner(false);
          setUser(u);
        }}
      />
    );
  if (!user)
    return (
      <Login
        done={(value) => {
          window.history.replaceState({}, "", "/");
          setUser(value);
        }}
      />
    );
  if (user.mustChangePassword)
    return (
      <Password
        user={user}
        done={setUser}
        logout={logout}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
    );
  return (
    <BrowserRouter>
      <Layout
        user={user}
        logout={logout}
        loggingOut={loggingOut}
        logoutError={logoutError}
        offline={offline}
      />
    </BrowserRouter>
  );
}
function FormShell({
  title,
  error,
  children,
}: {
  title: string;
  error: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth">
      <section>
        <div className="logo">M</div>
        <h1>{title}</h1>
        {error && <div className="error">{error}</div>}
        {children}
      </section>
    </main>
  );
}
function Onboarding({ done }: { done: (u: SafeUser) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    if (field(f, "password") !== field(f, "confirm"))
      return setError("Les mots de passe ne correspondent pas");
    setBusy(true);
    try {
      const x = await request<AuthResponse>("/bootstrap/owner", {
        method: "POST",
        json: {
          shopName: field(f, "shop"),
          fullName: field(f, "name"),
          username: field(f, "username"),
          email: field(f, "email"),
          password: field(f, "password"),
          barcodePrefix: field(f, "prefix"),
        },
      });
      done(x.user);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormShell title="Créer le magasin en ligne" error={error}>
      <p>Cette opération ne sera disponible qu’une fois.</p>
      <form onSubmit={submit}>
        <input name="shop" placeholder="Nom du magasin" required />
        <input name="name" placeholder="Nom du propriétaire" required />
        <input name="username" placeholder="Identifiant" required />
        <input name="email" type="email" placeholder="E-mail facultatif" />
        <input name="prefix" defaultValue="MKT" required />
        <input
          name="password"
          type="password"
          placeholder="Mot de passe fort"
          required
        />
        <input
          name="confirm"
          type="password"
          placeholder="Confirmation"
          required
        />
        <button disabled={busy}>Créer</button>
      </form>
    </FormShell>
  );
}
function Login({ done }: { done: (u: SafeUser) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [blockedUntil, setBlockedUntil] = useState(0),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= blockedUntil) setBlockedUntil(0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [blockedUntil]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || Date.now() < blockedUntil) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      done(
        (
          await request<AuthResponse>("/auth/login", {
            method: "POST",
            json: {
              login: field(f, "login"),
              password: field(f, "password"),
            },
          })
        ).user,
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "Connexion impossible");
      const password = e.currentTarget.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      if (x instanceof ApiFailure && x.status === 429)
        setBlockedUntil(Date.now() + (x.retryAfterSeconds ?? 60) * 1000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormShell title="Connexion" error={error}>
      <form onSubmit={submit}>
        <label>
          Identifiant ou e-mail
          <input name="login" autoComplete="username" autoFocus required />
        </label>
        <input
          name="password"
          type="password"
          aria-label="Mot de passe"
          autoComplete="current-password"
          required
        />
        <button disabled={busy || Date.now() < blockedUntil} aria-busy={busy}>
          {busy
            ? "Connexion…"
            : Date.now() < blockedUntil
              ? "Veuillez patienter…"
              : "Se connecter"}
        </button>
        {blockedUntil > clock && (
          <small role="status">
            Réessayez dans {Math.ceil((blockedUntil - clock) / 1000)}{" "}
            seconde(s).
          </small>
        )}
      </form>
    </FormShell>
  );
}
function Password({
  user,
  done,
  logout,
  loggingOut,
  logoutError,
}: {
  user: SafeUser;
  done: (u: SafeUser) => void;
  logout: () => void;
  loggingOut: boolean;
  logoutError: string;
}) {
  const [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (field(f, "new") !== field(f, "confirm"))
      return setError("Les mots de passe ne correspondent pas");
    try {
      done(
        (
          await request<AuthResponse>("/auth/change-password", {
            method: "POST",
            json: {
              currentPassword: field(f, "current"),
              newPassword: field(f, "new"),
            },
          })
        ).user,
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    }
  };
  return (
    <FormShell title="Changer le mot de passe" error={error}>
      {logoutError && (
        <div className="error" role="alert">
          {logoutError}
        </div>
      )}
      <p>Bonjour {user.fullName}. Définissez votre mot de passe personnel.</p>
      <form onSubmit={submit}>
        <input
          name="current"
          type="password"
          placeholder="Mot de passe temporaire"
          required
        />
        <input
          name="new"
          type="password"
          placeholder="Nouveau mot de passe"
          required
        />
        <input
          name="confirm"
          type="password"
          placeholder="Confirmation"
          required
        />
        <button>Continuer</button>
        <button
          type="button"
          className="secondary"
          onClick={logout}
          disabled={loggingOut}
        >
          {loggingOut ? "Déconnexion…" : "Déconnexion"}
        </button>
      </form>
    </FormShell>
  );
}
function Layout({
  user,
  logout,
  loggingOut,
  logoutError,
  offline,
}: {
  user: SafeUser;
  logout: () => void;
  loggingOut: boolean;
  logoutError: string;
  offline: boolean;
}) {
  const [menu, setMenu] = useState(false),
    loc = useLocation();
  useEffect(() => setMenu(false), [loc]);
  return (
    <div className="app">
      <aside className={menu ? "open" : ""}>
        <div className="brand">
          Maktaba <small>Version en ligne</small>
        </div>
        <nav>
          <NavLink to="/">Tableau de bord</NavLink>
          {user.permissions.includes("products.view") && (
            <NavLink to="/products">Produits</NavLink>
          )}
          {user.permissions.includes("categories.view") && (
            <NavLink to="/categories">Catégories</NavLink>
          )}
          {user.permissions.includes("stock.view") && (
            <NavLink to="/stock">Stock</NavLink>
          )}
          {user.permissions.includes("register.view") && (
            <NavLink to="/register">Caisse</NavLink>
          )}
          {user.permissions.includes("pos.use") && (
            <NavLink to="/pos">Point de vente</NavLink>
          )}
          {isTauriRuntime() && user.permissions.includes("pos.use") && (
            <NavLink to="/offline-queue">Opérations hors ligne</NavLink>
          )}
          {user.permissions.includes("sales.view") && (
            <NavLink to="/sales">Ventes</NavLink>
          )}
          {user.permissions.includes("customers.view") && (
            <NavLink to="/customers">Clients</NavLink>
          )}
          {user.permissions.includes("suppliers.view") && (
            <NavLink to="/suppliers">Fournisseurs</NavLink>
          )}
          {user.permissions.includes("purchases.view") && (
            <NavLink to="/purchases">Achats</NavLink>
          )}
          {user.permissions.includes("expenses.view") && (
            <NavLink to="/expenses">Dépenses</NavLink>
          )}
          {user.permissions.includes("returns.view") && (
            <NavLink to="/returns">Retours</NavLink>
          )}
          {user.permissions.includes("users.view") && (
            <NavLink to="/employees">Employés</NavLink>
          )}
          {user.permissions.some((p) => p.startsWith("reports.view_")) && (
            <NavLink to="/reports">Rapports</NavLink>
          )}
          {user.permissions.includes("audit.view") && (
            <NavLink to="/audit">Audit</NavLink>
          )}
          {user.permissions.includes("settings.view") && (
            <NavLink to="/settings">Paramètres</NavLink>
          )}
          {user.permissions.includes("backups.create") && (
            <NavLink to="/backups">Sauvegardes</NavLink>
          )}
        </nav>
        <footer>
          {logoutError && <small role="alert">{logoutError}</small>}
          <b>{user.fullName}</b>
          <small>{user.role}</small>
          <button onClick={logout} disabled={loggingOut} aria-busy={loggingOut}>
            {loggingOut ? "Déconnexion…" : "Déconnexion"}
          </button>
        </footer>
      </aside>
      <div className="main">
        {offline && (
          <div className="offline-banner" role="status">
            Mode hors ligne — certaines fonctions sont indisponibles.
          </div>
        )}
        <header>
          <button onClick={() => setMenu(!menu)}>☰</button>
          <span>Connexion sécurisée</span>
        </header>
        {offline && !["/pos", "/offline-queue"].includes(loc.pathname) ? (
          <main className="page">
            <h1>Fonction indisponible hors ligne</h1>
            <p>Reconnectez-vous au serveur. Seules les ventes comptant avec un cache valide sont disponibles dans l’application de bureau.</p>
            <NavLink to="/pos">Ouvrir le point de vente</NavLink>
          </main>
        ) : <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<main className="page">Chargement…</main>}>
                <Dashboard user={user} />
              </Suspense>
            }
          />
          <Route
            path="/categories"
            element={
              <Lazy>
                <CategoriesPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/categories/new"
            element={
              <Lazy>
                <CategoryForm />
              </Lazy>
            }
          />
          <Route
            path="/categories/:id/edit"
            element={
              <Lazy>
                <CategoryForm edit />
              </Lazy>
            }
          />
          <Route
            path="/products"
            element={
              <Lazy>
                <ProductsPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/products/new"
            element={
              <Lazy>
                <ProductForm />
              </Lazy>
            }
          />
          <Route
            path="/products/:id"
            element={
              <Lazy>
                <ProductDetails user={user} />
              </Lazy>
            }
          />
          <Route
            path="/products/:id/edit"
            element={
              <Lazy>
                <ProductForm edit />
              </Lazy>
            }
          />
          <Route
            path="/stock"
            element={
              <Lazy>
                <StockPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/stock/adjust"
            element={
              <Lazy>
                <StockAdjust />
              </Lazy>
            }
          />
          <Route
            path="/stock/movements"
            element={
              <Lazy>
                <StockMovements />
              </Lazy>
            }
          />
          <Route
            path="/register"
            element={
              <Lazy>
                <RegisterPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/register/open"
            element={
              <Lazy>
                <RegisterOpen />
              </Lazy>
            }
          />
          <Route
            path="/register/close"
            element={
              <Lazy>
                <RegisterClose />
              </Lazy>
            }
          />
          <Route
            path="/register/sessions"
            element={
              <Lazy>
                <RegisterSessions />
              </Lazy>
            }
          />
          <Route
            path="/register/sessions/:id"
            element={
              <Lazy>
                <RegisterSessionDetails />
              </Lazy>
            }
          />
          <Route
            path="/register/movements"
            element={
              <Lazy>
                <RegisterMovements />
              </Lazy>
            }
          />
          <Route
            path="/customers"
            element={
              <Lazy>
                <CustomersPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/customers/new"
            element={
              <Lazy>
                <CustomerForm />
              </Lazy>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <Lazy>
                <CustomerDetails user={user} />
              </Lazy>
            }
          />
          <Route
            path="/customers/:id/edit"
            element={
              <Lazy>
                <CustomerForm edit />
              </Lazy>
            }
          />
          <Route
            path="/customers/:id/payment"
            element={
              <Lazy>
                <CustomerPayment />
              </Lazy>
            }
          />
          <Route
            path="/pos"
            element={
              <Lazy>
                <PosPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/offline-queue"
            element={
              <Lazy>
                <OfflineQueuePage />
              </Lazy>
            }
          />
          <Route
            path="/sales"
            element={
              <Lazy>
                <SalesPage />
              </Lazy>
            }
          />
          <Route
            path="/sales/:id"
            element={
              <Lazy>
                <SaleDetails />
              </Lazy>
            }
          />
          <Route
            path="/suppliers"
            element={
              <Lazy>
                <SuppliersPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/suppliers/new"
            element={
              <Lazy>
                <SupplierForm />
              </Lazy>
            }
          />
          <Route
            path="/suppliers/:id"
            element={
              <Lazy>
                <SupplierDetails user={user} />
              </Lazy>
            }
          />
          <Route
            path="/suppliers/:id/edit"
            element={
              <Lazy>
                <SupplierForm edit />
              </Lazy>
            }
          />
          <Route
            path="/suppliers/:id/payment"
            element={
              <Lazy>
                <SupplierPayment />
              </Lazy>
            }
          />
          <Route
            path="/purchases"
            element={
              <Lazy>
                <PurchasesPage />
              </Lazy>
            }
          />
          <Route
            path="/purchases/new"
            element={
              <Lazy>
                <PurchaseForm user={user} />
              </Lazy>
            }
          />
          <Route
            path="/purchases/:id"
            element={
              <Lazy>
                <PurchaseDetails />
              </Lazy>
            }
          />
          <Route
            path="/expenses"
            element={
              <Lazy>
                <ExpensesPage />
              </Lazy>
            }
          />
          <Route
            path="/expenses/new"
            element={
              <Lazy>
                <ExpenseForm />
              </Lazy>
            }
          />
          <Route
            path="/expenses/:id"
            element={
              <Lazy>
                <ExpenseDetails user={user} />
              </Lazy>
            }
          />
          <Route
            path="/expenses/:id/correct"
            element={
              <Lazy>
                <ExpenseCorrection />
              </Lazy>
            }
          />
          <Route
            path="/returns"
            element={
              <Lazy>
                <ReturnsPage />
              </Lazy>
            }
          />
          <Route
            path="/returns/new"
            element={
              <Lazy>
                <ReturnForm />
              </Lazy>
            }
          />
          <Route
            path="/returns/:id"
            element={
              <Lazy>
                <ReturnDetails />
              </Lazy>
            }
          />
          <Route
            path="/sales/:id/return"
            element={
              <Lazy>
                <ReturnForm />
              </Lazy>
            }
          />
          <Route
            path="/employees"
            element={
              <Lazy>
                <EmployeesPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/employees/new"
            element={
              <Lazy>
                <EmployeeForm />
              </Lazy>
            }
          />
          <Route
            path="/employees/:id"
            element={
              <Lazy>
                <EmployeeDetails user={user} />
              </Lazy>
            }
          />
          <Route
            path="/employees/:id/edit"
            element={
              <Lazy>
                <EmployeeForm edit />
              </Lazy>
            }
          />
          <Route
            path="/employees/:id/reset-password"
            element={
              <Lazy>
                <PasswordReset />
              </Lazy>
            }
          />
          <Route
            path="/audit"
            element={
              <Lazy>
                <AuditPage />
              </Lazy>
            }
          />
          <Route
            path="/reports"
            element={
              <Lazy>
                <ReportsHub user={user} />
              </Lazy>
            }
          />
          {(
            [
              "sales",
              "profit",
              "stock",
              "customers",
              "suppliers",
              "expenses",
              "workers",
              "registers",
            ] as const
          ).map((kind) => (
            <Route
              key={kind}
              path={`/reports/${kind}`}
              element={
                <Lazy>
                  <ReportPage kind={kind} user={user} />
                </Lazy>
              }
            />
          ))}
          <Route
            path="/settings"
            element={
              <Lazy>
                <SettingsPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/backups"
            element={
              <Lazy>
                <BackupsPage user={user} />
              </Lazy>
            }
          />
          <Route
            path="/products/:id/label"
            element={
              <Lazy>
                <ProductLabel />
              </Lazy>
            }
          />
          <Route path="/forbidden" element={<State title="Accès interdit" />} />
          <Route path="*" element={<State title="Page introuvable" />} />
        </Routes>}
      </div>
    </div>
  );
}
function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<main className="page">Chargement…</main>}>
      {children}
    </Suspense>
  );
}
function Offline({ retry }: { retry: () => void }) {
  return (
    <State title="Connexion indisponible">
      <p>
        L’API ne répond pas. Les opérations financières ne sont jamais mises en
        file hors ligne.
      </p>
      <button onClick={retry}>Réessayer</button>
    </State>
  );
}
function State({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="center">
      <section>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
