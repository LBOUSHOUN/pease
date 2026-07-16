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
    await database.db.insert(users).values({
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

async function openRegister(sessionCookie: string, key = crypto.randomUUID()) {
  return app.inject({
    method: "POST",
    url: "/api/register/open",
    headers: { cookie: sessionCookie },
    payload: {
      openingCashCents: 20000,
      denominations: [{ denominationCents: 20000, quantity: 1 }],
      idempotencyKey: key,
    },
  });
}
async function phase3Product(sessionCookie: string, stock = 10) {
  const cat = (await category(sessionCookie)).json(),
    product = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: sessionCookie },
        payload: productBody(cat.id, { sellingPriceCents: 1250 }),
      })
    ).json();
  if (stock)
    await app.inject({
      method: "POST",
      url: "/api/stock/adjustments",
      headers: { cookie: sessionCookie },
      payload: {
        productId: product.id,
        movementType: "opening_stock",
        quantity: stock,
        reason: "Stock initial",
      },
    });
  return product;
}
async function phase3Customer(sessionCookie: string) {
  return (
    await app.inject({
      method: "POST",
      url: "/api/customers",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Client Test",
        phone: "06 12 34 56 78",
        creditLimitCents: 100000,
      },
    })
  ).json();
}
async function createSale(
  sessionCookie: string,
  productId: number,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/sales",
    headers: { cookie: sessionCookie },
    payload: {
      items: [{ productId, quantity: 1 }],
      paymentMode: "cash",
      cashPaidCents: 0,
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    },
  });
  return response;
}

describe("online register, customers, credit and sales", () => {
  it("opens idempotently, validates denominations and closes with a reason", async () => {
    const session = await phase2Owner(),
      key = crypto.randomUUID();
    expect((await openRegister(session, key)).statusCode).toBe(201);
    expect((await openRegister(session, key)).json().duplicate).toBe(true);
    expect((await openRegister(session)).statusCode).toBe(409);
    const status = await app.inject({
      url: "/api/register/status",
      headers: { cookie: session },
    });
    expect(status.json().expectedCashCents).toBe(20000);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/register/close",
          headers: { cookie: session },
          payload: {
            actualCashCents: 10000,
            denominations: [{ denominationCents: 10000, quantity: 1 }],
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(400);
    const closed = await app.inject({
      method: "POST",
      url: "/api/register/close",
      headers: { cookie: session },
      payload: {
        actualCashCents: 10000,
        denominations: [{ denominationCents: 10000, quantity: 1 }],
        differenceReason: "Écart comptage",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().differenceCents).toBe(-10000);
  });

  it("creates customers and records an atomic idempotent debt payment", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session),
      customer = await phase3Customer(session);
    const sale = await createSale(session, product.id, {
      customerId: customer.id,
      paymentMode: "credit",
    });
    expect(sale.statusCode).toBe(201);
    expect(sale.json().creditAmountCents).toBe(1250);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/customers/${customer.id}/payments`,
          headers: { cookie: session },
          payload: { amountCents: 250, idempotencyKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    await openRegister(session);
    const key = crypto.randomUUID(),
      payment = { amountCents: 250, note: "Espèces", idempotencyKey: key };
    const first = await app.inject({
      method: "POST",
      url: `/api/customers/${customer.id}/payments`,
      headers: { cookie: session },
      payload: payment,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().remainingDebtCents).toBe(1000);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/customers/${customer.id}/payments`,
          headers: { cookie: session },
          payload: payment,
        })
      ).json().duplicate,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/customers/${customer.id}/payments`,
          headers: { cookie: session },
          payload: { amountCents: 2000, idempotencyKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("creates cash, credit, partial, service and mixed sales using server prices", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 10),
      customer = await phase3Customer(session);
    const cat = (
      await app.inject({ url: "/api/categories", headers: { cookie: session } })
    ).json().rows[0];
    const service = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: session },
        payload: productBody(cat.id, {
          name: "Photocopie",
          productType: "service",
          trackStock: false,
          sku: null,
          manufacturerBarcode: null,
          sellingPriceCents: 200,
        }),
      })
    ).json();
    await openRegister(session);
    expect((await createSale(session, product.id)).json().totalCents).toBe(
      1250,
    );
    expect(
      (
        await createSale(session, service.id, {
          customerId: customer.id,
          paymentMode: "credit",
        })
      ).statusCode,
    ).toBe(201);
    const partial = await createSale(session, product.id, {
      customerId: customer.id,
      paymentMode: "partial",
      cashPaidCents: 500,
      items: [
        { productId: product.id, quantity: 1 },
        { productId: service.id, quantity: 2 },
      ],
    });
    expect(partial.json()).toMatchObject({
      totalCents: 1650,
      cashPaidCents: 500,
      creditAmountCents: 1150,
    });
    const detail = await app.inject({
      url: `/api/sales/${partial.json().id}`,
      headers: { cookie: session },
    });
    expect(detail.json().items).toHaveLength(2);
  });

  it("returns one sale for concurrent duplicate submissions", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 2),
      key = crypto.randomUUID();
    await openRegister(session);
    const responses = await Promise.all([
      createSale(session, product.id, { idempotencyKey: key }),
      createSale(session, product.id, { idempotencyKey: key }),
    ]);
    expect(
      responses.filter((x) => x.statusCode === 201 || x.statusCode === 200),
    ).toHaveLength(2);
    const count =
      await database.sql`select count(*)::int count from sales where idempotency_key=${key}`;
    expect(count[0]!.count).toBe(1);
  });

  it("allows only one concurrent sale of the last stock unit", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 1);
    await openRegister(session);
    const responses = await Promise.all([
      createSale(session, product.id),
      createSale(session, product.id),
    ]);
    expect(responses.map((x) => x.statusCode).sort()).toEqual([201, 409]);
    const [row] =
      await database.sql`select current_stock from products where id=${product.id}`;
    expect(row!.current_stock).toBe(0);
  });

  it("keeps concurrent customer credit updates consistent", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 4),
      customer = await phase3Customer(session);
    const responses = await Promise.all([
      createSale(session, product.id, {
        customerId: customer.id,
        paymentMode: "credit",
      }),
      createSale(session, product.id, {
        customerId: customer.id,
        paymentMode: "credit",
      }),
    ]);
    expect(responses.every((x) => x.statusCode === 201)).toBe(true);
    const [row] =
      await database.sql`select current_debt_cents from customers where id=${customer.id}`;
    expect(Number(row!.current_debt_cents)).toBe(2500);
  });

  it("serializes concurrent debt payments without a negative balance", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 2),
      customer = await phase3Customer(session);
    await createSale(session, product.id, {
      customerId: customer.id,
      paymentMode: "credit",
    });
    await openRegister(session);
    const pay = () =>
      app.inject({
        method: "POST",
        url: `/api/customers/${customer.id}/payments`,
        headers: { cookie: session },
        payload: { amountCents: 1000, idempotencyKey: crypto.randomUUID() },
      });
    const responses = await Promise.all([pay(), pay()]);
    expect(responses.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    const [row] =
      await database.sql`select current_debt_cents from customers where id=${customer.id}`;
    expect(Number(row!.current_debt_cents)).toBe(250);
  });

  it("keeps sale-versus-adjustment and sale-versus-close outcomes consistent", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 1);
    await openRegister(session);
    const adjustment = app.inject({
      method: "POST",
      url: "/api/stock/adjustments",
      headers: { cookie: session },
      payload: {
        productId: product.id,
        movementType: "stock_out",
        quantity: 1,
        reason: "Sortie concurrente",
      },
    });
    const [sale, stock] = await Promise.all([
      createSale(session, product.id),
      adjustment,
    ]);
    expect(
      [sale.statusCode, stock.statusCode].filter((code) => code < 300),
    ).toHaveLength(1);
    const [row] =
      await database.sql`select current_stock from products where id=${product.id}`;
    expect(Number(row!.current_stock)).toBe(0);
    await app.inject({
      method: "POST",
      url: "/api/stock/adjustments",
      headers: { cookie: session },
      payload: {
        productId: product.id,
        movementType: "stock_in",
        quantity: 1,
        reason: "Préparation concurrence",
      },
    });
    const close = app.inject({
      method: "POST",
      url: "/api/register/close",
      headers: { cookie: session },
      payload: {
        actualCashCents: 20000,
        denominations: [{ denominationCents: 20000, quantity: 1 }],
        differenceReason: "Test concurrent",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const secondSale = createSale(session, product.id);
    const outcomes = await Promise.all([close, secondSale]);
    expect(outcomes[0]!.statusCode).toBe(200);
    expect([200, 201, 409]).toContain(outcomes[1]!.statusCode);
    expect(
      (
        await app.inject({
          url: "/api/register/status",
          headers: { cookie: session },
        })
      ).json().isOpen,
    ).toBe(false);
  });
  it("keeps paginated Phase 3 reads responsive", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 2),
      customer = await phase3Customer(session);
    await openRegister(session);
    await createSale(session, product.id, {
      customerId: customer.id,
      paymentMode: "partial",
      cashPaidCents: 500,
    });
    const urls = [
        "/api/register/status",
        "/api/customers",
        "/api/sales",
        "/api/register/movements",
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
      samples.sort((a, b) => a - b);
      timings[url] = Number(samples[2]!.toFixed(2));
      expect(timings[url]).toBeLessThan(1000);
    }
    console.info("PHASE3_TIMINGS_MS", timings);
  });
  it("rejects Phase 3 operations for a stock-only role", async () => {
    await phase2Owner();
    const argon2 = (await import("argon2")).default;
    await database.sql`insert into users(full_name,username,password_hash,role) values('Stock','stock3',${await argon2.hash("Secret123")},'stock_worker')`;
    const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { login: "stock3", password: "Secret123" },
      }),
      restricted = cookie(login);
    for (const value of [
      { method: "GET" as const, url: "/api/customers" },
      { method: "GET" as const, url: "/api/register/status" },
      { method: "POST" as const, url: "/api/sales", payload: {} },
    ])
      expect(
        (await app.inject({ ...value, headers: { cookie: restricted } }))
          .statusCode,
      ).toBe(403);
  });
});
