import { beforeAll, describe, expect, it } from "vitest";
let buildApp: typeof import("../src/app.js").buildApp;
beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:59999/test";
  process.env.SESSION_PEPPER = "test-pepper-that-is-longer-than-thirty-two-characters";
  process.env.APP_ORIGIN = "http://localhost:5173";
  ({ buildApp } = await import("../src/app.js"));
});
describe("API foundation", () => {
  it("answers health without database access", async () => { const app=await buildApp(); const r=await app.inject("/health"); expect(r.statusCode).toBe(200); expect(r.json()).toEqual({status:"ok"}); await app.close(); });
  it("reports readiness failure without PostgreSQL", async () => { const app=await buildApp(); const r=await app.inject("/ready"); expect(r.statusCode).toBe(503); await app.close(); });
});
