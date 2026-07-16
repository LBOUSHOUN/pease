import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { SafeUser } from "@maktaba/shared-types";
import { request, AuthResponse } from "./api";
function field(f: FormData, n: string) {
  return String(f.get(n) ?? "");
}
export default function App() {
  const [user, setUser] = useState<SafeUser | null | undefined>(),
    [needsOwner, setNeedsOwner] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const refresh = useCallback(async () => {
    try {
      const b = (await fetch("/api/bootstrap/status").then((r) =>
        r.json(),
      )) as { needsOnboarding: boolean };
      setNeedsOwner(b.needsOnboarding);
      if (!b.needsOnboarding) {
        try {
          setUser((await request<AuthResponse>("/auth/me")).user);
        } catch {
          setUser(null);
        }
      } else setUser(null);
      setOffline(false);
    } catch {
      setOffline(true);
      setUser(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const online = () => void refresh(),
      off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);
  if (user === undefined)
    return <div className="center">Initialisation sécurisée…</div>;
  if (offline) return <Offline retry={refresh} />;
  if (needsOwner)
    return (
      <Onboarding
        done={(u) => {
          setNeedsOwner(false);
          setUser(u);
        }}
      />
    );
  if (!user) return <Login done={setUser} />;
  if (user.mustChangePassword)
    return (
      <Password
        user={user}
        done={setUser}
        logout={async () => {
          await request("/auth/logout", { method: "POST" });
          setUser(null);
        }}
      />
    );
  return (
    <BrowserRouter>
      <Layout
        user={user}
        logout={async () => {
          await request("/auth/logout", { method: "POST" });
          setUser(null);
        }}
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
        body: JSON.stringify({
          shopName: field(f, "shop"),
          fullName: field(f, "name"),
          username: field(f, "username"),
          email: field(f, "email"),
          password: field(f, "password"),
          barcodePrefix: field(f, "prefix"),
        }),
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
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      done(
        (
          await request<AuthResponse>("/auth/login", {
            method: "POST",
            body: JSON.stringify({
              login: field(f, "login"),
              password: field(f, "password"),
            }),
          })
        ).user,
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormShell title="Connexion" error={error}>
      <form onSubmit={submit}>
        <input name="login" placeholder="Identifiant ou e-mail" required />
        <input
          name="password"
          type="password"
          placeholder="Mot de passe"
          required
        />
        <button disabled={busy}>Se connecter</button>
      </form>
    </FormShell>
  );
}
function Password({
  user,
  done,
  logout,
}: {
  user: SafeUser;
  done: (u: SafeUser) => void;
  logout: () => void;
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
            body: JSON.stringify({
              currentPassword: field(f, "current"),
              newPassword: field(f, "new"),
            }),
          })
        ).user,
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "Erreur");
    }
  };
  return (
    <FormShell title="Changer le mot de passe" error={error}>
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
        <button type="button" className="secondary" onClick={logout}>
          Déconnexion
        </button>
      </form>
    </FormShell>
  );
}
function Layout({ user, logout }: { user: SafeUser; logout: () => void }) {
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
        </nav>
        <footer>
          <b>{user.fullName}</b>
          <small>{user.role}</small>
          <button onClick={logout}>Déconnexion</button>
        </footer>
      </aside>
      <div className="main">
        <header>
          <button onClick={() => setMenu(!menu)}>☰</button>
          <span>Connexion sécurisée</span>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/forbidden" element={<State title="Accès interdit" />} />
          <Route path="*" element={<State title="Page introuvable" />} />
        </Routes>
      </div>
    </div>
  );
}
function Dashboard() {
  const [data, setData] = useState<{ message: string } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void request<{ message: string }>("/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="page">
      <h1>Tableau de bord</h1>
      <p>
        Fondation de la version en ligne. Aucun module métier n’est encore
        activé.
      </p>
      {error ? (
        <div className="error">{error}</div>
      ) : (
        <div className="card">{data?.message ?? "Chargement…"}</div>
      )}
    </main>
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
