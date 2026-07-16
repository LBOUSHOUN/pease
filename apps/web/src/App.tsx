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
import type { SafeUser } from "@maktaba/shared-types";
import { request, AuthResponse, ApiFailure } from "./api";
import { initializeAuth, resetAuthInitialization } from "./auth-bootstrap";
import { singleFlight } from "./single-flight";
const Dashboard = lazy(() => import("./Dashboard"));
const phase2 = () => import("./Phase2");
const CategoriesPage = lazy(() => phase2().then((m) => ({ default: m.CategoriesPage })));
const CategoryForm = lazy(() => phase2().then((m) => ({ default: m.CategoryForm })));
const ProductsPage = lazy(() => phase2().then((m) => ({ default: m.ProductsPage })));
const ProductForm = lazy(() => phase2().then((m) => ({ default: m.ProductForm })));
const ProductDetails = lazy(() => phase2().then((m) => ({ default: m.ProductDetails })));
const StockPage = lazy(() => phase2().then((m) => ({ default: m.StockPage })));
const StockAdjust = lazy(() => phase2().then((m) => ({ default: m.StockAdjust })));
const StockMovements = lazy(() => phase2().then((m) => ({ default: m.StockMovements })));
function field(f: FormData, n: string) {
  return String(f.get(n) ?? "");
}
export default function App() {
  const [user, setUser] = useState<SafeUser | null | undefined>(),
    [needsOwner, setNeedsOwner] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine),
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
        setUser(null);
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const online = () => void refresh(),
      off = () => setOffline(true);
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
    };
  }, [refresh]);
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
  if (offline) return <Offline retry={retry} />;
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
}: {
  user: SafeUser;
  logout: () => void;
  loggingOut: boolean;
  logoutError: string;
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
          {user.permissions.includes("products.view") && <NavLink to="/products">Produits</NavLink>}
          {user.permissions.includes("categories.view") && <NavLink to="/categories">Catégories</NavLink>}
          {user.permissions.includes("stock.view") && <NavLink to="/stock">Stock</NavLink>}
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
        <header>
          <button onClick={() => setMenu(!menu)}>☰</button>
          <span>Connexion sécurisée</span>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<main className="page">Chargement…</main>}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route path="/categories" element={<Lazy><CategoriesPage user={user}/></Lazy>} />
          <Route path="/categories/new" element={<Lazy><CategoryForm/></Lazy>} />
          <Route path="/categories/:id/edit" element={<Lazy><CategoryForm edit/></Lazy>} />
          <Route path="/products" element={<Lazy><ProductsPage user={user}/></Lazy>} />
          <Route path="/products/new" element={<Lazy><ProductForm/></Lazy>} />
          <Route path="/products/:id" element={<Lazy><ProductDetails user={user}/></Lazy>} />
          <Route path="/products/:id/edit" element={<Lazy><ProductForm edit/></Lazy>} />
          <Route path="/stock" element={<Lazy><StockPage user={user}/></Lazy>} />
          <Route path="/stock/adjust" element={<Lazy><StockAdjust/></Lazy>} />
          <Route path="/stock/movements" element={<Lazy><StockMovements/></Lazy>} />
          <Route path="/forbidden" element={<State title="Accès interdit" />} />
          <Route path="*" element={<State title="Page introuvable" />} />
        </Routes>
      </div>
    </div>
  );
}
function Lazy({children}:{children:React.ReactNode}){return <Suspense fallback={<main className="page">Chargement…</main>}>{children}</Suspense>}
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
