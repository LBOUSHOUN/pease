import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production Railway web proxy", () => {
  const server = readFileSync(resolve(process.cwd(), "server.mjs"), "utf8");
  it("forwards /api to the Railway API without stripping the prefix", () => {
    expect(server).toContain('new URL(request.url, upstream)');
    expect(server).toContain('url.pathname.startsWith("/api/")');
    expect(server).not.toContain('replace("/api"');
  });
  it("does not expose the API as a Vite secret", () => {
    expect(server).not.toContain("DATABASE_URL");
    expect(server).not.toContain("SESSION_PEPPER");
  });
});
