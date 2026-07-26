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
    expect(() => resolveApiBaseUrl({ env: {}, location: { protocol: "tauri:" } })).toThrow("VITE_DESKTOP_API_URL");
  });

  it("uses a configured same-origin API path when provided", () => {
    expect(
      resolveApiBaseUrl({
        env: { VITE_API_URL: "/custom-api" },
        location: { protocol: "http:" },
      }),
    ).toBe("/custom-api");
  });
  it("builds the exact installed desktop health URL", () => {
    expect(buildApiUrl("/health", {
      env: { VITE_DESKTOP_API_URL: "http://127.0.0.1:3000/api" },
      location: { protocol: "tauri:" },
    })).toBe("http://127.0.0.1:3000/api/health");
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
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).has("x-maktaba-client")).toBe(false);
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
  it("rejects an HTML SPA fallback instead of treating login as successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>Application</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(request("/auth/login", { method: "POST" })).rejects.toMatchObject({
      status: 502,
      data: { code: "INVALID_RESPONSE" },
    });
  });
  it("forces production browsers through the same-origin API proxy", () => {
    expect(
      resolveApiBaseUrl({
        env: {
          VITE_API_URL: "https://pease-production.up.railway.app/api",
        },
        location: {
          protocol: "https:",
          origin: "https://doublelibrary.online",
        },
      }),
    ).toBe("/api");
  });
  it("keeps native desktop on its explicit Railway API origin", () => {
    expect(
      resolveApiBaseUrl({
        env: {
          VITE_API_URL: "/api",
          VITE_DESKTOP_API_URL:
            "https://pease-production.up.railway.app/api",
        },
        location: { protocol: "tauri:" },
      }),
    ).toBe("https://pease-production.up.railway.app/api");
  });
  it.each([
    new DOMException("signal is aborted without reason", "AbortError"),
    new Error("operation cancelled"),
  ])("preserves cancellation without reporting network downtime", async (reason) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
    await expect(request("/x")).rejects.toSatisfy(
      (error: unknown) =>
        error === reason ||
        (error instanceof Error && error.name === "AbortError"),
    );
  });
});
