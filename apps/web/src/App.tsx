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
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { RegisterStatus, SafeUser } from "@maktaba/shared-types";
import { request, AuthResponse, ApiFailure } from "./api";
import { initializeAuth, OfflineColdStartError, resetAuthInitialization } from "./auth-bootstrap";
import { singleFlight } from "./single-flight";
import { checkConnection, getOfflineCacheStatus, getOfflineQueueSummary, isTauriRuntime, refreshOfflineCache, syncPendingOfflineSales } from "./offline-pos";
import { useScanner } from "./use-scanner";
import { enqueueGlobalScan, hasBlockingScannerContext } from "./global-scanner";
import { deleteDesktopSessionToken, DesktopTokenStorageError, isNativeDesktop, saveDesktopSessionToken } from "./desktop-session";
import { connectionDiagnostics, recordConnectionAttempt, resetConnectionDiagnostics, type ConnectionDiagnostics } from "./connection-diagnostics";
import { clearOfflineAuthSnapshot, saveOfflineAuthSnapshot } from "./offline-auth";
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
const SerializedReceiving = lazy(() => import("./SerializedReceiving"));
const StockPage = lazy(() => phase2().then((m) => ({ default: m.StockPage })));
const StockReceiving = lazy(() => import("./StockReceiving"));
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
    [authNotice, setAuthNotice] = useState(""),
    [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics>(() => connectionDiagnostics()),
    [loggingOut, setLoggingOut] = useState(false),
    [logoutError, setLogoutError] = useState("");
  const logoutAction = useRef<() => Promise<void>>(undefined);
  const refresh = useCallback(async () => {
    try {
      const result = await initializeAuth();
      setNeedsOwner(result.needsOwner);
      setUser(result.user);
      setOffline(result.offline);
      setDiagnostics(connectionDiagnostics());
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        setOffline(false);
        setAuthNotice(
          error.data.code === "SESSION_EXPIRED" ? "Votre session a expiré. Reconnectez-vous."
            : error.data.code === "SESSION_REVOKED" ? "Votre session a été révoquée. Reconnectez-vous."
              : error.data.code === "SESSION_INVALID" ? "Votre session n’est plus valide. Reconnectez-vous." : "",
        );
        setUser(null);
      } else if (error instanceof DesktopTokenStorageError) {
        recordConnectionAttempt({ category: "credential_manager", errorName: error.name, message: error.message, fetchAttempted: false });
        setOffline(false);
        setAuthNotice(error.message);
        setUser(null);
      } else if (error instanceof OfflineColdStartError) {
        setOffline(true);
        setAuthNotice(error.message);
        setUser(null);
      } else {
        if (!(error instanceof ApiFailure)) recordConnectionAttempt({ category: "unexpected", errorName: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) });
        setOffline(true);
        setDiagnostics(connectionDiagnostics());
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
    void (async () => {
      await syncPendingOfflineSales(request, user.id).catch(() => undefined);
      const register = await request<RegisterStatus>("/register/status");
      await refreshOfflineCache({ isOpen: register.isOpen, sessionId: register.sessionId });
    })().catch(() => undefined);
  }, [offline, user]);
  if (user === undefined)
    return <div className="center">Initialisation sécurisée…</div>;
  const retry = async () => {
    resetConnectionDiagnostics();
    resetAuthInitialization();
    setUser(undefined);
    setAuthNotice("");
    await refresh();
  };
  logoutAction.current = singleFlight(async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      if (offline) {
        const pending = (await getOfflineQueueSummary())?.pendingCount ?? 0;
        if (pending > 0 && !window.confirm(`${pending} opération(s) resteront en attente et seront verrouillées jusqu’à la reconnexion du même utilisateur. Continuer ?`)) return;
      } else await request<void>("/auth/logout", { method: "POST" });
      await clearOfflineAuthSnapshot();
      await deleteDesktopSessionToken();
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
    return <Offline retry={retry} diagnostics={diagnostics} />;
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
        notice={authNotice}
        done={(value) => {
          setAuthNotice("");
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
        retry={retry}
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
        <div className="logo" aria-hidden="true">DL</div>
        <p className="auth-brand">Double Library POS</p>
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
      if (isNativeDesktop()) {
        if (!x.desktopSession) throw new DesktopTokenStorageError();
        await saveDesktopSessionToken(x.desktopSession.token);
        await saveOfflineAuthSnapshot(x.user);
      }
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
          placeholder="Mot de passe"
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
function Login({ done, notice }: { done: (u: SafeUser) => void; notice: string }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
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
      const response = await request<AuthResponse>("/auth/login", {
            method: "POST",
            json: {
              login: field(f, "login"),
              password: field(f, "password"),
            },
          });
      if (isNativeDesktop()) {
        if (!response.desktopSession) throw new DesktopTokenStorageError();
        await saveDesktopSessionToken(response.desktopSession.token);
        await saveOfflineAuthSnapshot(response.user);
      }
      done(response.user);
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
    <FormShell title="Connexion" error={error || notice}>
      <form onSubmit={submit}>
        <label>
          Identifiant ou e-mail
          <input name="login" autoComplete="username" autoFocus required />
        </label>
        <label>
          Mot de passe
          <span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required /><button type="button" className="password-toggle" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Masquer" : "Afficher"}</button></span>
        </label>
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
      const response = await request<AuthResponse>("/auth/change-password", {
            method: "POST",
            json: {
              currentPassword: field(f, "current"),
              newPassword: field(f, "new"),
            },
          });
      if (isNativeDesktop()) {
        if (!response.desktopSession) throw new DesktopTokenStorageError();
        await saveDesktopSessionToken(response.desktopSession.token);
        await saveOfflineAuthSnapshot(response.user);
      }
      done(response.user);
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
function OfflineHome({ user }: { user: SafeUser }) {
  const [cache, setCache] = useState<Awaited<ReturnType<typeof getOfflineCacheStatus>>>(),
    [queue, setQueue] = useState<Awaited<ReturnType<typeof getOfflineQueueSummary>>>();
  useEffect(() => { void Promise.all([getOfflineCacheStatus(), getOfflineQueueSummary()]).then(([c, q]) => { setCache(c); setQueue(q); }); }, []);
  return <main className="page">
    <h1>Mode hors ligne sécurisé</h1>
    <p>Session locale de <strong>{user.fullName}</strong>. Les autorisations en ligne mises en cache restent appliquées.</p>
    <div className="metrics">
      <article><small>Dernière synchronisation</small><strong>{cache?.lastRefreshAt ? new Date(cache.lastRefreshAt).toLocaleString("fr-FR") : "Indisponible"}</strong></article>
      <article><small>Produits en cache</small><strong>{cache?.productCount ?? 0}</strong></article>
      <article><small>Ventes en attente</small><strong>{queue?.pendingCount ?? 0}</strong></article>
      <article><small>Caisse observée</small><strong>{cache?.register?.isOpen ? "Ouverte" : "Fermée"}</strong></article>
    </div>
    <p>Les données affichées datent de la dernière synchronisation. Seules les ventes comptant autorisées peuvent être mises en attente.</p>
    <div className="form-actions"><NavLink to="/pos">Ouvrir le point de vente</NavLink><NavLink to="/offline-queue">Voir les opérations hors ligne</NavLink></div>
  </main>;
}

function OfflineRegister() {
  const [cache, setCache] = useState<Awaited<ReturnType<typeof getOfflineCacheStatus>>>();
  useEffect(() => { void getOfflineCacheStatus().then(setCache); }, []);
  return <main className="page">
    <h1>Caisse — état hors ligne</h1>
    <div className="section-card">
      <p><strong>{cache?.register?.isOpen ? "Ouverte lors de la dernière synchronisation" : "Fermée lors de la dernière synchronisation"}</strong></p>
      <p>Dernière synchronisation : {cache?.lastRefreshAt ? new Date(cache.lastRefreshAt).toLocaleString("fr-FR") : "indisponible"}</p>
      <p>L’ouverture, la fermeture et les mouvements manuels sont désactivés hors ligne.</p>
    </div>
  </main>;
}

function Layout({
  user,
  logout,
  loggingOut,
  logoutError,
  offline,
  retry,
}: {
  user: SafeUser;
  logout: () => void;
  loggingOut: boolean;
  logoutError: string;
  offline: boolean;
  retry: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false),
    [scannerEnabled, setScannerEnabled] = useState(true),
    [scannerWarning, setScannerWarning] = useState(""),
    [unknownBarcode, setUnknownBarcode] = useState(""),
    loc = useLocation(),
    navigate = useNavigate(),
    scannerAvailable = user.permissions.includes("pos.use");
  useScanner(
    async (barcode) => {
      if (!scannerAvailable || !scannerEnabled) return;
      const active = document.activeElement;
      if (loc.pathname === "/stock/receive" || active instanceof HTMLElement && active.closest("[data-scanner-input]")) return;
      if (hasBlockingScannerContext()) {
        setScannerWarning("Fermez le formulaire ou la boîte de dialogue avant de scanner.");
        return;
      }
      setScannerWarning("");
      setUnknownBarcode("");
      setScannerWarning("");
      navigate("/pos");
      enqueueGlobalScan(barcode);
    },
    { maxIntervalMs: 80, minLength: 3, duplicateWindowMs: 0 },
  );
  useEffect(() => {
    setMenu(false);
    setUnknownBarcode("");
    setScannerWarning("");
  }, [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  useEffect(() => {
    if (!scannerAvailable) return;
    const toggleScanner = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setScannerEnabled((value) => !value);
      }
    };
    window.addEventListener("keydown", toggleScanner);
    return () => window.removeEventListener("keydown", toggleScanner);
  }, [scannerAvailable]);
  return (
    <div className="app">
      <aside id="app-sidebar" className={menu ? "open" : ""} aria-label="Navigation principale">
        <div className="brand">
          Double Library POS <small>Version en ligne</small>
        </div>
        <nav aria-label="Modules">
          <NavLink to="/">Tableau de bord</NavLink>
          {!offline && user.permissions.includes("products.view") && (
            <NavLink to="/products">Produits</NavLink>
          )}
          {!offline && user.permissions.includes("categories.view") && (
            <NavLink to="/categories">Catégories</NavLink>
          )}
          {!offline && user.permissions.includes("stock.view") && (
            <NavLink to="/stock">Stock</NavLink>
          )}
          {!offline && user.permissions.includes("stock.adjust") && (
            <NavLink to="/stock/receive">Réception de stock</NavLink>
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
          {!offline && user.permissions.includes("sales.view") && (
            <NavLink to="/sales">Ventes</NavLink>
          )}
          {!offline && user.permissions.includes("customers.view") && (
            <NavLink to="/customers">Clients</NavLink>
          )}
          {!offline && user.permissions.includes("suppliers.view") && (
            <NavLink to="/suppliers">Fournisseurs</NavLink>
          )}
          {!offline && user.permissions.includes("purchases.view") && (
            <NavLink to="/purchases">Achats</NavLink>
          )}
          {!offline && user.permissions.includes("expenses.view") && (
            <NavLink to="/expenses">Dépenses</NavLink>
          )}
          {!offline && user.permissions.includes("returns.view") && (
            <NavLink to="/returns">Retours</NavLink>
          )}
          {!offline && user.permissions.includes("users.view") && (
            <NavLink to="/employees">Employés</NavLink>
          )}
          {!offline && user.permissions.some((p) => p.startsWith("reports.view_")) && (
            <NavLink to="/reports">Rapports</NavLink>
          )}
          {!offline && user.permissions.includes("audit.view") && (
            <NavLink to="/audit">Audit</NavLink>
          )}
          {!offline && user.permissions.includes("settings.view") && (
            <NavLink to="/settings">Paramètres</NavLink>
          )}
          {!offline && user.permissions.includes("backups.create") && (
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
      {menu && <button className="sidebar-overlay" aria-label="Fermer la navigation" onClick={() => setMenu(false)} />}
      <div className="main">
        {offline && (
          <div className="offline-banner" role="status">
            Mode hors ligne sécurisé — profil et cache vérifiés. Certaines fonctions sont indisponibles.
            <button type="button" className="secondary" onClick={() => void retry()}>Réessayer</button>
          </div>
        )}
        <header>
          <button className="menu-toggle" aria-label="Ouvrir la navigation" aria-controls="app-sidebar" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          <span className="topbar-title">Double Library POS</span>
          {scannerAvailable && (
            <button type="button" className="scanner-toggle secondary" aria-pressed={scannerEnabled} onClick={() => setScannerEnabled((value) => !value)}>
              {scannerEnabled ? "Scanner global activé" : "Scanner global désactivé"}
            </button>
          )}
          <span className="connection-status">Connexion sécurisée</span>
        </header>
        {scannerWarning && <div className="scanner-warning" role="alert">{scannerWarning}</div>}
        {unknownBarcode && (
          <div className="scanner-unknown" role="dialog" aria-modal="true" aria-labelledby="unknown-barcode-title">
            <div className="section-card">
              <h2 id="unknown-barcode-title">Produit inconnu</h2>
              <p>Le code-barres <strong>{unknownBarcode}</strong> n’existe pas encore.</p>
              <div className="form-actions">
                <button type="button" className="secondary" onClick={() => setUnknownBarcode("")}>Fermer</button>
                {user.permissions.includes("products.create") ? (
                  <button type="button" onClick={() => { const code = unknownBarcode; setUnknownBarcode(""); navigate(`/products/new?barcode=${encodeURIComponent(code)}`); }}>Créer ce produit</button>
                ) : <p>Vous ne disposez pas de la permission nécessaire pour créer un produit.</p>}
              </div>
            </div>
          </div>
        )}
        <div className="page-scroll">
        {offline && !["/", "/register", "/pos", "/offline-queue"].includes(loc.pathname) ? (
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
                {offline ? <OfflineHome user={user} /> : <Dashboard user={user} />}
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
              user.permissions.includes("products.create") ? (
                <Lazy><ProductForm user={user} offline={offline} /></Lazy>
              ) : <Navigate to="/forbidden" replace />
            }
          />
          <Route
            path="/products/:id"
            element={
              <Lazy>
                <ProductDetails user={user} offline={offline} />
              </Lazy>
            }
          />
          <Route
            path="/products/:id/edit"
            element={
              <Lazy>
                <ProductForm edit user={user} offline={offline} />
              </Lazy>
            }
          />
          <Route
            path="/serialized-receiving/new"
            element={
              user.permissions.includes("serialized_units.receive")
                ? <Lazy><SerializedReceiving user={user} /></Lazy>
                : <Navigate to="/forbidden" replace />
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
            path="/stock/receive"
            element={user.permissions.includes("stock.adjust") ? <Lazy><StockReceiving user={user} /></Lazy> : <Navigate to="/" replace />}
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
                {offline ? <OfflineRegister /> : <RegisterPage user={user} />}
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
                <OfflineQueuePage user={user} />
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
            path="/sales/:id/receipt"
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
function Offline({ retry, diagnostics }: { retry: () => Promise<void>; diagnostics: ConnectionDiagnostics }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await retry(); } finally { setBusy(false); }
  };
  return (
    <State title="Connexion indisponible">
      <p>
        L’API ne répond pas. Les opérations financières ne sont jamais mises en
        file hors ligne.
      </p>
      <button onClick={() => void run()} disabled={busy}>{busy ? "Connexion en cours…" : "Réessayer"}</button>
      <details className="connection-diagnostics" open>
        <summary>Diagnostic de connexion</summary>
        <dl>
          <dt>Origine de l’application</dt><dd>{diagnostics.applicationOrigin}</dd>
          <dt>Protocole</dt><dd>{diagnostics.protocol}</dd>
          <dt>Nom d’hôte</dt><dd>{diagnostics.hostname}</dd>
          <dt>Exécution Tauri</dt><dd>{diagnostics.isTauri ? "oui" : "non"}</dd>
          <dt>Base API configurée</dt><dd>{diagnostics.apiBaseUrl}</dd>
          <dt>URL de santé testée</dt><dd>{diagnostics.healthUrl}</dd>
          <dt>Transport HTTP</dt><dd>{diagnostics.transport === "native" ? "Tauri natif" : "Navigateur"}</dd>
          <dt>Requête tentée</dt><dd>{diagnostics.fetchAttempted ? "oui" : "non"}</dd>
          <dt>Catégorie</dt><dd>{diagnostics.category}</dd>
          <dt>Nom de l’erreur</dt><dd>{diagnostics.errorName}</dd>
          <dt>Message</dt><dd>{diagnostics.message}</dd>
          <dt>Statut HTTP</dt><dd>{diagnostics.httpStatus ?? "—"}</dd>
          <dt>Horodatage</dt><dd>{diagnostics.testedAt}</dd>
        </dl>
      </details>
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
