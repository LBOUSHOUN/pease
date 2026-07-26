import { invoke, isTauri } from "@tauri-apps/api/core";

let loaded: Promise<string | null> | undefined;

export type DesktopTokenStorageCategory =
  | "invalid_token"
  | "credential_manager_unavailable"
  | "credential_write_failed"
  | "credential_read_failed"
  | "tauri_command_missing";

const categories: DesktopTokenStorageCategory[] = [
  "invalid_token",
  "credential_manager_unavailable",
  "credential_write_failed",
  "credential_read_failed",
  "tauri_command_missing",
];

function sanitizedFailure(reason: unknown, fallback: DesktopTokenStorageCategory) {
  const raw = reason instanceof Error ? reason.message : String(reason ?? "");
  const category =
    categories.find((candidate) => raw.startsWith(`${candidate}:`)) ??
    (/command.*not found|unknown command|invoke.*missing/i.test(raw)
      ? "tauri_command_missing"
      : fallback);
  return {
    category,
    reason: raw
      .replace(/Bearer\s+\S+/gi, "Bearer [masqué]")
      .replace(/[A-Za-z0-9_.~+/=-]{32,}/g, "[valeur masquée]")
      .slice(0, 240),
  };
}

export class DesktopTokenStorageError extends Error {
  constructor(
    public readonly category: DesktopTokenStorageCategory = "credential_write_failed",
    message = "Connexion réussie, mais la session n’a pas pu être enregistrée.",
  ) {
    super(message);
    this.name = "DesktopTokenStorageError";
  }
}

export const isNativeDesktop = () => {
  try {
    return (
      isTauri() ||
      (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    );
  } catch {
    return false;
  }
};

export function loadDesktopSessionToken(): Promise<string | null> {
  if (!isNativeDesktop()) return Promise.resolve(null);
  loaded ??= invoke<string | null>("load_desktop_session_token")
    .then((value) => {
      console.info("[desktop-auth] token load completed", {
        found: value !== null,
      });
      return value;
    })
    .catch((reason) => {
      const failure = sanitizedFailure(reason, "credential_read_failed");
      console.warn("[desktop-auth] token load failed", failure);
      loaded = undefined;
      throw new DesktopTokenStorageError(
        failure.category,
        "Le Gestionnaire d’identifiants Windows est indisponible.",
      );
    });
  return loaded;
}

export async function saveDesktopSessionToken(value: string) {
  if (!isNativeDesktop()) return;
  try {
    await invoke("save_desktop_session_token", { token: value });
    const verified = await invoke<string | null>("load_desktop_session_token");
    if (verified !== value)
      throw new DesktopTokenStorageError(
        "credential_write_failed",
        "Connexion réussie, mais la session enregistrée n’a pas pu être vérifiée.",
      );
    loaded = Promise.resolve(value);
  } catch (reason) {
    loaded = Promise.resolve(null);
    if (reason instanceof DesktopTokenStorageError) throw reason;
    const failure = sanitizedFailure(reason, "credential_write_failed");
    console.warn("[desktop-auth] token save failed", failure);
    throw new DesktopTokenStorageError(failure.category);
  }
}

export async function clearInMemoryDesktopSessionToken() {
  loaded = Promise.resolve(null);
}

export async function deleteDesktopSessionToken() {
  if (!isNativeDesktop()) return;
  loaded = Promise.resolve(null);
  try {
    await invoke("delete_desktop_session_token");
  } catch {
    /* local memory is still cleared */
  }
}

export async function desktopAuthorization(): Promise<string | null> {
  return isNativeDesktop()
    ? loaded
      ? await loaded
      : await loadDesktopSessionToken()
    : null;
}

export function resetDesktopSessionForTests() {
  loaded = undefined;
}
