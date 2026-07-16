import postgres from "postgres";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const testUrl = "postgresql://maktaba:maktaba_dev@127.0.0.1:5433/maktaba_test";
let app: FastifyInstance;
let database: Awaited<typeof import("../src/db/index.js")>;

beforeAll(async () => {
  process.env.DATABASE_URL = testUrl;
  process.env.SESSION_PEPPER =
    "test-pepper-that-is-longer-than-thirty-two-characters";
  process.env.APP_ORIGIN = "http://localhost:5173";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.LOGIN_RATE_LIMIT = "8";
  const admin = postgres(
    "postgresql://maktaba:maktaba_dev@127.0.0.1:5433/postgres",
  );
  const exists =
    await admin`select 1 from pg_database where datname='maktaba_test'`;
  if (!exists.length) await admin.unsafe("create database maktaba_test");
  await admin.end();
  database = await import("../src/db/index.js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  ({ buildApp: asyncBuild } = await import("../src/app.js"));
  app = await asyncBuild();
});
let asyncBuild: () => Promise<FastifyInstance>;
beforeEach(async () => {
  await database.sql.unsafe(
    "truncate table app_settings, users restart identity cascade",
  );
});
afterAll(async () => {
  await app?.close();
  await database?.sql.end();
});

let ownerRequest = 1;
async function owner() {
  return app.inject({
    method: "POST",
    url: "/api/bootstrap/owner",
    remoteAddress: `10.1.0.${ownerRequest++}`,
    payload: {
      shopName: "Maktaba",
      fullName: "Propriétaire",
      username: " Owner ",
      email: " OWNER@EXAMPLE.COM ",
      password: "Secret123",
      barcodePrefix: "MKT",
    },
  });
}
function cookie(response: { headers: Record<string, unknown> }) {
  return String(response.headers["set-cookie"]).split(";")[0]!;
}

describe("online authentication", () => {
  it("answers health and database readiness", async () => {
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/ready")).statusCode).toBe(200);
  });
  it("creates the owner once and normalizes identity", async () => {
    const first = await owner();
    expect(first.statusCode).toBe(201);
    expect(first.json().user.username).toBe("owner");
    expect((await owner()).statusCode).toBe(409);
  });
  it("logs in by normalized username and email", async () => {
    await owner();
    for (const login of [" OWNER ", "owner@example.com", "OWNER@EXAMPLE.COM"]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { login, password: "Secret123" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["set-cookie"]).toContain("HttpOnly");
    }
  });
  it("returns 401 for wrong and unknown credentials", async () => {
    await owner();
    for (const body of [
      { login: "owner", password: "wrong" },
      { login: "nobody", password: "Secret123" },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: body,
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe("BAD_CREDENTIALS");
    }
  });
  it("rejects inactive users", async () => {
    await owner();
    const { users } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await database.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.username, "owner"));
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: "owner", password: "Secret123" },
    });
    expect(r.statusCode).toBe(403);
  });
  it("persists auth, accepts empty logout, revokes and clears cookie idempotently", async () => {
    const created = await owner(),
      sessionCookie = cookie(created);
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(200);
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: sessionCookie },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("maktaba_session=;");
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api/auth/logout" }))
        .statusCode,
    ).toBe(200);
  });
  it("rate limits repeated failed login attempts", async () => {
    await owner();
    let last;
    for (let i = 0; i < 9; i++)
      last = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "10.0.0.8",
        payload: { login: "owner", password: "wrong" },
      });
    expect(last!.statusCode).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();
    expect(last!.json().code).toBe("RATE_LIMITED");
  });
});
