import { invoke, isTauri } from "@tauri-apps/api/core";

let loaded: Promise<string | null> | undefined;

export class DesktopTokenStorageError extends Error {
  readonly category = "credential_manager";
  constructor(message = "Connexion réussie, mais la session n’a pas pu être enregistrée.") {
    super(message);
    this.name = "DesktopTokenStorageError";
  }
}

export const isNativeDesktop = () => {
  try {
    return isTauri() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
  } catch { return false; }
};

export function loadDesktopSessionToken(): Promise<string | null> {
  if (!isNativeDesktop()) return Promise.resolve(null);
  loaded ??= invoke<string | null>("load_desktop_session_token")
    .then((value) => {
      console.info("[desktop-auth] token load completed", { found: value !== null });
      return value;
    })
    .catch(() => {
      console.warn("[desktop-auth] token load failed", { category: "credential_manager" });
      loaded = undefined;
      throw new DesktopTokenStorageError("Le Gestionnaire d’identifiants Windows est indisponible.");
    });
  return loaded;
}

export async function saveDesktopSessionToken(value: string) {
  if (!isNativeDesktop()) return;
  try {
    await invoke("save_desktop_session_token", { token: value });
    loaded = Promise.resolve(value);
  } catch {
    throw new DesktopTokenStorageError();
  }
}

export async function deleteDesktopSessionToken() {
  if (!isNativeDesktop()) return;
  loaded = Promise.resolve(null);
  try { await invoke("delete_desktop_session_token"); } catch { /* local memory is still cleared */ }
}

export async function desktopAuthorization(): Promise<string | null> {
  return isNativeDesktop() ? (loaded ? await loaded : await loadDesktopSessionToken()) : null;
}

export function resetDesktopSessionForTests() {
  loaded = undefined;
}
