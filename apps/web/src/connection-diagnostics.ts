import { isNativeDesktop } from "./desktop-session";

export type ConnectionErrorCategory =
  | "none" | "network" | "timeout" | "cancelled" | "http" | "api_url"
  | "csp_webview" | "tauri_command" | "credential_manager"
  | "desktop_token" | "unexpected";

export type ConnectionDiagnostics = {
  applicationOrigin: string;
  protocol: string;
  hostname: string;
  isTauri: boolean;
  apiBaseUrl: string;
  healthUrl: string;
  transport: "native" | "browser";
  fetchAttempted: boolean;
  category: ConnectionErrorCategory;
  errorName: string;
  message: string;
  httpStatus?: number;
  testedAt: string;
};

let last: Partial<ConnectionDiagnostics> = {};
const safeMessage = (value: unknown) => String(value ?? "Erreur inconnue").replace(/Bearer\s+\S+/gi, "Bearer [masqué]").slice(0, 240);

export function recordConnectionAttempt(value: Partial<ConnectionDiagnostics>) {
  last = { ...last, ...value, testedAt: new Date().toISOString() };
}

export function connectionDiagnostics(): ConnectionDiagnostics {
  const apiBaseUrl = last.apiBaseUrl ?? "Configuration indisponible",
    healthUrl = last.healthUrl ?? "Configuration indisponible";
  const location = typeof window === "undefined" ? undefined : window.location;
  const native = isNativeDesktop();
  return {
    applicationOrigin: location?.origin ?? "indisponible",
    protocol: location?.protocol ?? "indisponible",
    hostname: location?.hostname ?? "indisponible",
    isTauri: native,
    apiBaseUrl,
    healthUrl,
    transport: native ? "native" : "browser",
    fetchAttempted: last.fetchAttempted ?? false,
    category: last.category ?? "none",
    errorName: last.errorName ?? "—",
    message: safeMessage(last.message ?? "—"),
    httpStatus: last.httpStatus,
    testedAt: last.testedAt ?? new Date().toISOString(),
  };
}

export function resetConnectionDiagnostics() { last = {}; }
