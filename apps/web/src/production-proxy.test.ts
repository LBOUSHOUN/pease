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
  it("requests an uncompressed upstream body and never forwards stale encoding metadata", () => {
    expect(server).toContain('headers.set("accept-encoding", "identity")');
    expect(server).toContain('name !== "content-encoding"');
    expect(server).toContain('"content-length"');
    expect(server).toContain('"transfer-encoding"');
  });
  it("preserves response JSON and authentication cookies", () => {
    expect(server).toContain("for await (const chunk of upstreamResponse.body)");
    expect(server).toContain("upstreamResponse.headers.getSetCookie()");
    expect(server).toContain('responseHeaders["set-cookie"] = cookies');
  });
});
