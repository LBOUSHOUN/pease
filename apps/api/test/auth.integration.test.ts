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

async function phase2Owner() {
  const response = await owner();
  return cookie(response);
}
async function category(sessionCookie: string, name = "Papeterie") {
  return app.inject({
    method: "POST",
    url: "/api/categories",
    headers: { cookie: sessionCookie },
    payload: { name, description: "Articles" },
  });
}
const productBody = (
  categoryId: number,
  overrides: Record<string, unknown> = {},
) => ({
  categoryId,
  name: "Cahier",
  description: "96 pages",
  productType: "physical_product",
  sku: "CAH-1",
  manufacturerBarcode: "611000000001",
  purchasePriceCents: 500,
  sellingPriceCents: 800,
  wholesalePriceCents: 700,
  wholesaleMinQuantity: 10,
  minimumStock: 2,
  unit: "unité",
  shelfLocation: "A1",
  trackStock: true,
  ...overrides,
});

describe("online catalog and stock", () => {
  it("creates, searches, edits and toggles normalized categories", async () => {
    const session = await phase2Owner(),
      created = await category(session);
    expect(created.statusCode).toBe(201);
    expect((await category(session, " papeterie ")).statusCode).toBe(409);
    expect((await category(session, " ")).statusCode).toBe(400);
    const id = created.json().id;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/categories/${id}`,
          headers: { cookie: session },
          payload: { name: "Fournitures" },
        })
      ).json().name,
    ).toBe("Fournitures");
    const list = await app.inject({
      url: "/api/categories?search=Four&page=1&pageSize=1",
      headers: { cookie: session },
    });
    expect(list.json()).toMatchObject({ totalRows: 1, totalPages: 1 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/categories/${id}/deactivate`,
          headers: { cookie: session },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/categories/${id}/activate`,
          headers: { cookie: session },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("creates products and services with stable sequential identifiers", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json();
    const first = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie: session },
      payload: productBody(cat.id),
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().internalBarcode).toBe("MKT-000001");
    expect(first.json().qrIdentifier).toBe("MKT-P-MKT-000001");
    const service = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie: session },
      payload: productBody(cat.id, {
        name: "Photocopie",
        productType: "service",
        sku: "SVC-1",
        manufacturerBarcode: null,
        trackStock: true,
      }),
    });
    expect(service.json()).toMatchObject({
      trackStock: false,
      currentStock: 0,
    });
    const id = first.json().id,
      internal = first.json().internalBarcode;
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      headers: { cookie: session },
      payload: { name: "Cahier grand format" },
    });
    expect(edited.json().internalBarcode).toBe(internal);
    expect(edited.json().sku).toBe("CAH-1");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/products/${id}/deactivate`,
          headers: { cookie: session },
        })
      ).json().isActive,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/products/${id}/activate`,
          headers: { cookie: session },
        })
      ).json().isActive,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/categories/${cat.id}/deactivate`,
          headers: { cookie: session },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("generates unique sequential barcodes under concurrent creation", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json();
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id, {
            name: `Produit ${i}`,
            sku: `SKU-${i}`,
            manufacturerBarcode: `61100000000${i}`,
          }),
        }),
      ),
    );
    const codes = responses.map((r) => r.json().internalBarcode);
    expect(new Set(codes).size).toBe(5);
    expect(codes.sort()).toEqual([
      "MKT-000001",
      "MKT-000002",
      "MKT-000003",
      "MKT-000004",
      "MKT-000005",
    ]);
  });
  it("rejects duplicate identifiers, negative prices, and inactive categories", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id, { sellingPriceCents: -1 }),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id),
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id, { name: "Autre" }),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id, {
            name: "SKU dupliqué",
            manufacturerBarcode: "611000000002",
          }),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id, { name: "Code dupliqué", sku: "CAH-2" }),
        })
      ).statusCode,
    ).toBe(409);
    const empty = (await category(session, "Inactive")).json();
    await app.inject({
      method: "POST",
      url: `/api/categories/${empty.id}/deactivate`,
      headers: { cookie: session },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(empty.id, {
            sku: "X",
            manufacturerBarcode: "X",
          }),
        })
      ).statusCode,
    ).toBe(409);
  });
  it("looks up and filters products by every stable identifier", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json(),
      created = (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id),
        })
      ).json();
    for (const code of [
      created.sku,
      created.manufacturerBarcode,
      created.internalBarcode,
      created.qrIdentifier,
    ])
      expect(
        (
          await app.inject({
            url: `/api/products/lookup/${encodeURIComponent(code)}`,
            headers: { cookie: session },
          })
        ).statusCode,
      ).toBe(200);
    const list = await app.inject({
      url: "/api/products?search=CAH-1&productType=physical_product&pageSize=1",
      headers: { cookie: session },
    });
    expect(list.json()).toMatchObject({ totalRows: 1, totalPages: 1 });
    expect(
      (
        await app.inject({
          url: "/api/products/lookup/UNKNOWN",
          headers: { cookie: session },
        })
      ).json().message,
    ).toBe("Produit introuvable.");
  });
  it("records atomic adjustments, movements, audits and idempotency", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json(),
      p = (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id),
        })
      ).json();
    const adjust = (movementType: string, quantity: number, key: string) =>
      app.inject({
        method: "POST",
        url: "/api/stock/adjustments",
        headers: { cookie: session },
        payload: {
          productId: p.id,
          movementType,
          quantity,
          reason: "Test inventaire",
          idempotencyKey: key,
        },
      });
    expect(
      (await adjust("opening_stock", 10, "opening-0001")).json().stockAfter,
    ).toBe(10);
    expect(
      (await adjust("stock_in", 5, "stock-in-0001")).json().stockAfter,
    ).toBe(15);
    expect(
      (await adjust("stock_out", 3, "stock-out-0001")).json().stockAfter,
    ).toBe(12);
    expect((await adjust("damaged", 1, "damaged-0001")).json().stockAfter).toBe(
      11,
    );
    expect((await adjust("lost", 1, "lost-000001")).json().stockAfter).toBe(10);
    expect((await adjust("stock_out", 99, "too-much-01")).statusCode).toBe(409);
    expect((await adjust("stock_in", 1, "stock-in-0001")).statusCode).toBe(409);
    const detail = await app.inject({
      url: `/api/products/${p.id}`,
      headers: { cookie: session },
    });
    expect(detail.json().currentStock).toBe(10);
    const movements = await app.inject({
      url: `/api/stock/movements?productId=${p.id}&pageSize=2`,
      headers: { cookie: session },
    });
    expect(movements.json()).toMatchObject({ totalRows: 5, totalPages: 3 });
    const lostOnly = await app.inject({
      url: `/api/stock/movements?productId=${p.id}&movementType=lost`,
      headers: { cookie: session },
    });
    expect(lostOnly.json()).toMatchObject({ totalRows: 1 });
    const today = new Date().toISOString().slice(0, 10),
      dated = await app.inject({
        url: `/api/stock/movements?startDate=${today}&endDate=${today}`,
        headers: { cookie: session },
      });
    expect(dated.json().totalRows).toBe(5);
    const stockList = await app.inject({
      url: `/api/stock?categoryId=${cat.id}&status=active`,
      headers: { cookie: session },
    });
    expect(stockList.json()).toMatchObject({ totalRows: 1 });
    const audits =
      await database.sql`select count(*)::int as count from audit_logs where action='stock.adjusted'`;
    expect(audits[0]!.count).toBe(5);
  });
  it("serializes concurrent stock changes and rejects service adjustments", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json(),
      p = (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id),
        })
      ).json();
    await app.inject({
      method: "POST",
      url: "/api/stock/adjustments",
      headers: { cookie: session },
      payload: {
        productId: p.id,
        movementType: "opening_stock",
        quantity: 20,
        reason: "Ouverture",
      },
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/stock/adjustments",
          headers: { cookie: session },
          payload: {
            productId: p.id,
            movementType: "stock_out",
            quantity: 1,
            reason: "Sortie test",
            idempotencyKey: `parallel-${i}`,
          },
        }),
      ),
    );
    expect(
      (
        await app.inject({
          url: `/api/products/${p.id}`,
          headers: { cookie: session },
        })
      ).json().currentStock,
    ).toBe(10);
    const service = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: session },
        payload: productBody(cat.id, {
          name: "Service",
          productType: "service",
          sku: "SV",
          manufacturerBarcode: null,
        }),
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/stock/adjustments",
          headers: { cookie: session },
          payload: {
            productId: service.id,
            movementType: "stock_in",
            quantity: 1,
            reason: "Impossible",
          },
        })
      ).statusCode,
    ).toBe(409);
    const untracked = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: session },
        payload: productBody(cat.id, {
          name: "Non suivi",
          sku: "NS",
          manufacturerBarcode: null,
          trackStock: false,
        }),
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/stock/adjustments",
          headers: { cookie: session },
          payload: {
            productId: untracked.id,
            movementType: "stock_in",
            quantity: 1,
            reason: "Impossible",
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/stock/adjustments",
          headers: { cookie: session },
          payload: {
            productId: p.id,
            movementType: "stock_in",
            quantity: 1,
            reason: "",
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("changes product type safely and preserves stable identifiers", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json(),
      created = (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: session },
          payload: productBody(cat.id),
        })
      ).json();
    const converted = await app.inject({
      method: "PATCH",
      url: `/api/products/${created.id}`,
      headers: { cookie: session },
      payload: { productType: "service" },
    });
    expect(converted.statusCode).toBe(200);
    expect(converted.json()).toMatchObject({
      productType: "service",
      trackStock: false,
      currentStock: 0,
      internalBarcode: created.internalBarcode,
      qrIdentifier: created.qrIdentifier,
    });
    const stocked = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: session },
        payload: productBody(cat.id, {
          name: "Stocké",
          sku: "STOCKED",
          manufacturerBarcode: "611000000099",
        }),
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/stock/adjustments",
      headers: { cookie: session },
      payload: {
        productId: stocked.id,
        movementType: "opening_stock",
        quantity: 2,
        reason: "Stock initial",
      },
    });
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/products/${stocked.id}`,
      headers: { cookie: session },
      payload: { productType: "service" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain("stock");
    expect(
      (
        await app.inject({
          url: `/api/products/${stocked.id}`,
          headers: { cookie: session },
        })
      ).json(),
    ).toMatchObject({ productType: "physical_product", currentStock: 2 });
  });
  it("enforces category, product and stock permissions", async () => {
    const session = await phase2Owner();
    const argon2 = (await import("argon2")).default,
      { users } = await import("../src/db/schema.js");
    await database.db
      .insert(users)
      .values({
        fullName: "Caissier",
        username: "cash",
        passwordHash: await argon2.hash("Secret123"),
        role: "cashier",
      });
    const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        remoteAddress: "10.9.0.1",
        payload: { login: "cash", password: "Secret123" },
      }),
      cashier = cookie(login);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/categories",
          headers: { cookie: cashier },
          payload: { name: "Interdit" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/products",
          headers: { cookie: cashier },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/stock/adjustments",
          headers: { cookie: cashier },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/categories",
          headers: { cookie: cashier },
        })
      ).statusCode,
    ).toBe(200);
    void session;
  });
  it("keeps paginated Phase 2 reads responsive", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json();
    await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie: session },
      payload: productBody(cat.id),
    });
    const urls = [
        "/api/categories",
        "/api/products",
        "/api/stock",
        "/api/stock/movements",
      ],
      timings: Record<string, number> = {};
    for (const url of urls) {
      const samples: number[] = [];
      for (let index = 0; index < 5; index++) {
        const start = performance.now(),
          response = await app.inject({ url, headers: { cookie: session } });
        samples.push(performance.now() - start);
        expect(response.statusCode).toBe(200);
      }
      samples.sort((left, right) => left - right);
      timings[url] = Number(samples[2]!.toFixed(2));
      expect(timings[url]).toBeLessThan(1000);
    }
    console.info("PHASE2_TIMINGS_MS", timings);
  });
});
