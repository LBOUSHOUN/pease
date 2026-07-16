import type { ApiError, SafeUser } from "@maktaba/shared-types";

export type ApiRequest = Omit<RequestInit, "body"> & { json?: unknown };
export class ApiFailure extends Error {
  constructor(
    public data: ApiError,
    public status: number,
    public retryAfterSeconds?: number,
  ) {
    super(data.message);
    this.name = "ApiFailure";
  }
}

const messages: Record<number, string> = {
  400: "Vérifiez les informations saisies.",
  401: "Votre session a expiré. Veuillez vous reconnecter.",
  403: "Vous n’avez pas l’autorisation d’effectuer cette action.",
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
  return {
    code:
      typeof candidate.code === "string" ? candidate.code : `HTTP_${status}`,
    message: loginFailure
      ? "Identifiant ou mot de passe incorrect."
      : (messages[status] ?? messages[500]!),
    fieldErrors: candidate.fieldErrors,
    requestId: candidate.requestId ?? requestId,
  };
}

export async function request<T>(
  path: string,
  options: ApiRequest = {},
): Promise<T> {
  const { json, headers: suppliedHeaders, ...init } = options;
  const headers = new Headers(suppliedHeaders);
  let body: string | undefined;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers,
      body,
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiFailure(
      {
        code: "NETWORK_ERROR",
        message: "Impossible de joindre le serveur. Vérifiez votre connexion.",
      },
      0,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
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
    )
      window.dispatchEvent(new Event("session-expired"));
    throw failure;
  }
  return parsed as T;
}

export type AuthResponse = { user: SafeUser };
