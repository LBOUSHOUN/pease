import { FormEvent, useEffect, useState } from "react";
import type { AccountProfile, SafeUser } from "@maktaba/shared-types";
import { ApiFailure, request } from "./api";
import {
  clearInMemoryDesktopSessionToken,
  isNativeDesktop,
  saveDesktopSessionToken,
} from "./desktop-session";
import { isAbortError } from "./request-error";

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : "Une erreur est survenue.";
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("fr-MA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Casablanca",
      }).format(new Date(value))
    : "—";

export default function AccountPage({ user }: { user: SafeUser }) {
  const [profile, setProfile] = useState<AccountProfile>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [profileBusy, setProfileBusy] = useState(false),
    [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    request<{ profile: AccountProfile }>("/account/profile", {
      signal: controller.signal,
    })
      .then(({ profile: value }) => {
        if (!active) return;
        setProfile(value);
        setError("");
      })
      .catch((reason) => {
        if (active && !isAbortError(reason)) setError(errorMessage(reason));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || profileBusy) return;
    const form = new FormData(event.currentTarget);
    setProfileBusy(true);
    setNotice("");
    try {
      const result = await request<{ profile: AccountProfile }>(
        "/account/profile",
        {
          method: "PATCH",
          json: {
            fullName: form.get("fullName"),
            phone: form.get("phone") || null,
            email: form.get("email") || null,
            currentPassword: form.get("currentPassword") || undefined,
          },
        },
      );
      setProfile(result.profile);
      setError("");
      setNotice("Profil enregistré.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordBusy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPasswordBusy(true);
    setNotice("");
    try {
      const result = await request<{
        user: SafeUser;
        desktopSession?: { token: string };
      }>("/account/change-password", {
        method: "POST",
        json: {
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
          confirmation: form.get("confirmation"),
        },
      });
      if (isNativeDesktop() && !result.desktopSession?.token)
        throw new Error("Le serveur n’a pas fourni de nouvelle session de bureau.");
      if (isNativeDesktop() && result.desktopSession?.token) {
        const token = result.desktopSession.token;
        try {
          await saveDesktopSessionToken(token);
        } catch (reason) {
          await clearInMemoryDesktopSessionToken();
          await request("/auth/logout", {
            method: "POST",
            desktopTokenOverride: token,
          }).catch(() => undefined);
          throw reason;
        }
      }
      formElement.reset();
      setError("");
      setNotice(
        "Mot de passe modifié. Les autres sessions ont été déconnectées.",
      );
    } catch (reason) {
      const fieldMessage =
        reason instanceof ApiFailure
          ? Object.values(reason.data.fieldErrors ?? {}).flat()[0]
          : undefined;
      setError(fieldMessage ?? errorMessage(reason));
    } finally {
      setPasswordBusy(false);
    }
  };

  if (!profile)
    return (
      <main className="page">
        <h1>Mon compte</h1>
        {error ? <div className="error">{error}</div> : <p>Chargement…</p>}
      </main>
    );

  return (
    <main className="page account-page">
      <div className="page-header">
        <div>
          <h1>Mon compte</h1>
          <p>Gérez vos informations personnelles et votre sécurité.</p>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="account-grid">
        <form className="section-card grid-form" onSubmit={saveProfile}>
          <h2>Profil</h2>
          <label>Nom complet<input name="fullName" required minLength={2} maxLength={100} defaultValue={profile.fullName} /></label>
          <label>Téléphone<input name="phone" maxLength={40} defaultValue={profile.phone ?? ""} /></label>
          <label>Adresse e-mail<input name="email" type="email" maxLength={200} defaultValue={profile.email ?? ""} /></label>
          <label>Mot de passe actuel<input name="currentPassword" type="password" autoComplete="current-password" /><small>Requis uniquement pour modifier l’adresse e-mail.</small></label>
          <div className="account-readonly">
            <dl>
              <dt>Identifiant</dt><dd>{profile.username}</dd>
              <dt>Rôle</dt><dd>{profile.role}</dd>
              <dt>État</dt><dd>{profile.isActive ? "Actif" : "Inactif"}</dd>
              <dt>Création</dt><dd>{formatDate(profile.createdAt)}</dd>
              <dt>Dernière connexion</dt><dd>{formatDate(profile.lastLoginAt)}</dd>
              <dt>Permissions</dt><dd>{profile.permissions.join(", ") || "—"}</dd>
            </dl>
          </div>
          <button disabled={profileBusy}>{profileBusy ? "Enregistrement…" : "Enregistrer le profil"}</button>
        </form>
        <form className="section-card grid-form" onSubmit={changePassword}>
          <h2>Sécurité</h2>
          <label>Mot de passe actuel<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label>Nouveau mot de passe<input name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Confirmation<input name="confirmation" type="password" required minLength={8} autoComplete="new-password" /></label>
          <small>Au moins 8 caractères, avec une lettre et un chiffre.</small>
          <button disabled={passwordBusy}>{passwordBusy ? "Modification…" : "Modifier le mot de passe"}</button>
        </form>
      </div>
      <p className="muted">Session active : {user.fullName}</p>
    </main>
  );
}
