import type { ApiError, SafeUser } from "@maktaba/shared-types";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { deleteDesktopSessionToken, desktopAuthorization, isNativeDesktop } from "./desktop-session";
import { clearOfflineAuthSnapshot } from "./offline-auth";
import { recordConnectionAttempt, type ConnectionErrorCategory } from "./connection-diagnostics";
import { isAbortError } from "./request-error";
import {
  buildApiUrl,
  resolveHealthUrl,
} from "./api-base";
export { buildApiUrl, resolveApiBaseUrl, resolveHealthUrl } from "./api-base";

export type ApiRequest = Omit<RequestInit, "body"> & {
  json?: unknown;
  skipDesktopAuth?: boolean;
  desktopTokenOverride?: string;
};
export class ApiFailure extends Error {
  constructor(
    public data: ApiError,
    public status: number,
    public retryAfterSeconds?: number,
    public category: ConnectionErrorCategory = status > 0 ? "http" : "network",
  ) {
    super(data.message);
    this.name = "ApiFailure";
  }
}

const messages: Record<number, string> = {
  400: "Vérifiez les informations saisies.",
  401: "Votre session a expiré. Veuillez vous reconnecter.",
  403: "Vous n’avez pas l’autorisation d’effectuer cette action.",
  404: "Ressource introuvable.",
  409: "Cette opération existe déjà ou entre en conflit avec les données actuelles.",
  429: "Trop de tentatives. Réessayez dans quelques minutes.",
  500: "Une erreur interne est survenue. Réessayez plus tard.",
};

function normalizedError(
  status: number,
  body: unknown,
  requestId?: string,
): ApiError {
  const candidate =
    body && typeof body === "object" ? (body as Partial<ApiError>) : {};
  const loginFailure = status === 401 && candidate.code === "BAD_CREDENTIALS";
  const safeServerMessage =
    typeof candidate.message === "string" &&
    ["NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "INACTIVE_USER", "PASSWORD_CHANGE_REQUIRED"].includes(
      candidate.code ?? "",
    )
      ? candidate.message
      : undefined;
  return {
    code:
      typeof candidate.code === "string" ? candidate.code : `HTTP_${status}`,
    message:
      safeServerMessage ??
      (loginFailure
        ? "Identifiant ou mot de passe incorrect."
        : (messages[status] ?? messages[500]!)),
    fieldErrors: candidate.fieldErrors,
    requestId: candidate.requestId ?? requestId,
  };
}

export async function request<T>(
  path: string,
  options: ApiRequest = {},
): Promise<T> {
  const {
    json,
    headers: suppliedHeaders,
    skipDesktopAuth,
    desktopTokenOverride,
    ...init
  } = options;
  const headers = new Headers(suppliedHeaders);
  const native = isNativeDesktop();
  if (native) {
    headers.set("x-maktaba-client", "tauri-desktop");
    const token = skipDesktopAuth
      ? null
      : (desktopTokenOverride ?? (await desktopAuthorization()));
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let body: string | undefined;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  let url: string;
  try {
    url = buildApiUrl(path);
  } catch (error) {
    recordConnectionAttempt({ category: "api_url", errorName: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), fetchAttempted: false });
    throw error;
  }
  const base = url.slice(0, url.length - (path.startsWith("/") ? path.length : path.length + 1));
  recordConnectionAttempt({ apiBaseUrl: base, healthUrl: resolveHealthUrl(), transport: native ? "native" : "browser", fetchAttempted: true, category: "none", errorName: "—", message: "Requête démarrée" });
  if (native) console.info("[desktop-network] request started", { origin: typeof window === "undefined" ? "indisponible" : window.location.origin, apiBaseUrl: base, transport: "native", path });
  let response: Response;
  try {
    const transport = native ? nativeFetch : fetch;
    response = await transport(url, {
      ...init,
      headers,
      body,
      ...(native ? {} : { credentials: "include" as const }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error),
      timeout = error instanceof Error && error.name === "TimeoutError",
      cancelled = isAbortError(error),
      category: ConnectionErrorCategory = timeout ? "timeout"
        : cancelled ? "cancelled"
        : native && /scope|permission|not allowed|denied/i.test(message) ? "csp_webview"
          : native && /invoke|plugin|command/i.test(message) ? "tauri_command" : "network";
    recordConnectionAttempt({ category, errorName: error instanceof Error ? error.name : "Error", message, fetchAttempted: true });
    if (native) console.warn("[desktop-network] request failed", { path, category, errorName: error instanceof Error ? error.name : "Error" });
    if (cancelled) {
      if (error instanceof Error) throw error;
      throw new DOMException("La requête a été annulée.", "AbortError");
    }
    throw new ApiFailure(
      {
        code: timeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: timeout
          ? "Le délai de connexion à l’API est dépassé."
          : "Impossible de joindre le serveur. Vérifiez votre connexion.",
      },
      0,
      undefined,
      timeout ? "timeout" : category,
    );
  }
  recordConnectionAttempt({ category: response.ok ? "none" : "http", httpStatus: response.status, errorName: response.ok ? "—" : "HTTPError", message: response.ok ? "Requête réussie" : `Réponse HTTP ${response.status}` });
  if (native) console.info("[desktop-network] request completed", { path, status: response.status });
  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (response.ok && text && parsed === undefined) {
    throw new ApiFailure(
      {
        code: "INVALID_RESPONSE",
        message: "Le serveur a renvoyé une réponse invalide.",
      },
      502,
      undefined,
      "http",
    );
  }
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : undefined;
    const failure = new ApiFailure(
      normalizedError(response.status, parsed),
      response.status,
      seconds,
    );
    if (
      response.status === 401 &&
      failure.data.code !== "BAD_CREDENTIALS" &&
      typeof window !== "undefined"
    ) {
      if (native) {
        await clearOfflineAuthSnapshot().catch(() => undefined);
        await deleteDesktopSessionToken();
      }
      window.dispatchEvent(new Event("session-expired"));
    }
    throw failure;
  }
  return parsed as T;
}


function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const basic = disposition.match(/filename="?([^";]+)"?/i);
  const encoded = utf8?.[1];

  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  return basic?.[1] ?? fallback;
}

export async function downloadFile(path: string, fallbackFilename: string) {
  const headers = new Headers();
  const native = isNativeDesktop();

  if (native) {
    headers.set("x-maktaba-client", "tauri-desktop");
    const token = await desktopAuthorization();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const transport = native ? nativeFetch : fetch;
  const response = await transport(buildApiUrl(path), {
    headers,
    ...(native ? {} : { credentials: "include" as const }),
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: unknown;

    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    throw new ApiFailure(
      normalizedError(response.status, parsed),
      response.status,
    );
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = responseFilename(response, fallbackFilename);
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export type AuthResponse = { user: SafeUser; desktopSession?: { token: string; expiresAt: string } };
