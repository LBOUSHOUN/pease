import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldRegisterServiceWorker } from "./pwa";
describe("PWA development behavior", () => {
  it("never registers in development", () =>
    expect(shouldRegisterServiceWorker(false)).toBe(false));
  it("registers in production", () =>
    expect(shouldRegisterServiceWorker(true)).toBe(true));
  it("does not register the browser service worker inside Tauri", () =>
    expect(shouldRegisterServiceWorker(true, true)).toBe(false));
  it("keeps every authentication endpoint network-only and outside navigation fallback", () => {
    const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(config).toContain('handler: "NetworkOnly"');
    expect(config).toContain("navigateFallbackDenylist");
    for (const endpoint of ["/api/auth/login", "/api/auth/me", "/api/auth/logout"]) {
      expect(new URL(endpoint, "https://doublelibrary.online").pathname).toMatch(
        /^\/api(?:\/|$)/u,
      );
    }
  });
});
