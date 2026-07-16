import type { ApiError, SafeUser } from "@maktaba/shared-types";
export class ApiFailure extends Error {
  constructor(
    public data: ApiError,
    public status: number,
  ) {
    super(data.message);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await r
    .json()
    .catch(() => ({ code: "NETWORK_ERROR", message: "Réponse invalide" }));
  if (!r.ok) throw new ApiFailure(body, r.status);
  return body as T;
}
export type AuthResponse = { user: SafeUser };
