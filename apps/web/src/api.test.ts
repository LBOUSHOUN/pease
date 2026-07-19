import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiUrl, request, resolveApiBaseUrl } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("API client", () => {
  it("uses the canonical loopback host for desktop development", () => {
    expect(
      resolveApiBaseUrl({ env: { DEV: true }, location: { protocol: "tauri:" } }),
    ).toBe("http://127.0.0.1:3000/api");
    expect(buildApiUrl("/auth/me", { env: { DEV: true }, location: { protocol: "tauri:" } })).toBe(
      "http://127.0.0.1:3000/api/auth/me",
    );
  });

  it("requires an explicit API URL for production desktop builds", () => {
    expect(() => resolveApiBaseUrl({ env: {}, location: { protocol: "tauri:" } })).toThrow("VITE_API_URL");
  });

  it("uses the configured VITE_API_URL when provided", () => {
    expect(
      resolveApiBaseUrl({
        env: { VITE_API_URL: "https://api.example.com/api" },
        location: { protocol: "http:" },
      }),
    ).toBe("https://api.example.com/api");
  });
  it("sends empty logout without JSON body or content type", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await request<void>("/auth/logout", { method: "POST" });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    expect(init.credentials).toBe("include");
  });
  it("serializes JSON only when provided", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await request("/x", { method: "POST", json: { a: 1 } });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
  });
  it.each([
    [401, "BAD_CREDENTIALS", "Identifiant ou mot de passe incorrect."],
    [
      429,
      "RATE_LIMITED",
      "Trop de tentatives. Réessayez dans quelques minutes.",
    ],
    [
      500,
      "INTERNAL_ERROR",
      "Une erreur interne est survenue. Réessayez plus tard.",
    ],
  ])("maps HTTP %s", async (status, code, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code }), {
          status: Number(status),
          headers: { "retry-after": "60" },
        }),
      ),
    );
    await expect(request("/x")).rejects.toMatchObject({
      status,
      message,
      retryAfterSeconds: 60,
    });
  });
  it("normalizes network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    await expect(request("/x")).rejects.toEqual(
      expect.objectContaining({
        status: 0,
        message: "Impossible de joindre le serveur. Vérifiez votre connexion.",
      }),
    );
  });
});
