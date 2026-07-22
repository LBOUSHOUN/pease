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
  process.env.APP_ORIGIN = "http://127.0.0.1:5173";
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

describe("serialized unit receiving", () => {
  async function setup(expectedQuantity: number) {
    const sessionCookie = await phase2Owner();
    const cat = (await category(sessionCookie, `Sérialisé ${expectedQuantity}`)).json();
    const product = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: sessionCookie },
        payload: productBody(cat.id, {
          name: `Calculatrice ${expectedQuantity}`,
          sku: `SER-${expectedQuantity}`,
          manufacturerBarcode: `CARTON-${expectedQuantity}`,
          inventoryMode: "serialized",
        }),
      })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: "/api/serialized-receiving",
      headers: { cookie: sessionCookie },
      payload: { productId: product.id, expectedQuantity },
    });
    expect(response.statusCode, response.body).toBe(201);
    return { sessionCookie, product, session: response.json() };
  }

  it.each([1, 5, 7, 24, 50])("stores a dynamic expected quantity of %i", async (quantity) => {
    const { session } = await setup(quantity);
    expect(session.expectedQuantity).toBe(quantity);
    expect(session.remainingQuantity).toBe(quantity);
  });

  it("rejects duplicates, incomplete confirmation, a lower quantity and an extra scan", async () => {
    const { sessionCookie, session } = await setup(1);
    const scan = () => app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans`, headers: { cookie: sessionCookie }, payload: { barcode: "611000001" } });
    expect((await scan()).statusCode).toBe(201);
    expect((await scan()).statusCode).toBe(409);
    const lowered = await app.inject({ method: "PATCH", url: `/api/serialized-receiving/${session.id}/expected-quantity`, headers: { cookie: sessionCookie }, payload: { expectedQuantity: 0 } });
    expect(lowered.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans`, headers: { cookie: sessionCookie }, payload: { barcode: "611000002" } })).statusCode).toBe(409);
  });

  it("confirms atomically and derives stock from exactly five available units", async () => {
    const { sessionCookie, product, session } = await setup(5);
    const early = await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/confirm`, headers: { cookie: sessionCookie } });
    expect(early.statusCode).toBe(409);
    for (let index = 1; index <= 5; index++) {
      const scanned = await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans`, headers: { cookie: sessionCookie }, payload: { barcode: `61110000${index}` } });
      expect(scanned.statusCode, scanned.body).toBe(201);
    }
    const confirmed = await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/confirm`, headers: { cookie: sessionCookie } });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const [counts] = await database.sql`select count(*)::int units,count(*) filter(where status='available')::int available from product_units where product_id=${product.id}`;
    const [stored] = await database.sql`select current_stock from products where id=${product.id}`;
    expect(counts).toMatchObject({ units: 5, available: 5 });
    expect(Number(stored!.current_stock)).toBe(5);
    const lookup = await app.inject({ url: "/api/product-units/lookup/611100001", headers: { cookie: sessionCookie } });
    expect(lookup.statusCode, lookup.body).toBe(200);
    expect(lookup.json().product.id).toBe(product.id);
  });

  it("sells the exact serialized unit once and preserves sale idempotency", async () => {
    const { sessionCookie, product, session } = await setup(2);
    for (const barcode of ["622200001", "622200002"])
      expect((await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans`, headers: { cookie: sessionCookie }, payload: { barcode } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/confirm`, headers: { cookie: sessionCookie } })).statusCode).toBe(201);
    expect((await openRegister(sessionCookie)).statusCode).toBe(201);
    const idempotencyKey = crypto.randomUUID();
    const sell = () => app.inject({
      method: "POST", url: "/api/sales", headers: { cookie: sessionCookie, "idempotency-key": idempotencyKey },
      payload: { items: [{ productId: product.id, quantity: 1, unitBarcodes: ["622200001"] }], paymentMode: "cash", cashPaidCents: 0, idempotencyKey },
    });
    const first = await sell(), duplicate = await sell();
    expect(first.statusCode, first.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().id).toBe(first.json().id);
    const [unit] = await database.sql`select status,sale_id,sale_item_id from product_units where barcode='622200001'`;
    const [stock] = await database.sql`select current_stock from products where id=${product.id}`;
    expect(unit).toMatchObject({ status: "sold", sale_id: first.json().id });
    expect(unit!.sale_item_id).toBeTruthy();
    expect(Number(stock!.current_stock)).toBe(1);
    const secondSale = await app.inject({ method: "POST", url: "/api/sales", headers: { cookie: sessionCookie }, payload: { items: [{ productId: product.id, quantity: 1, unitBarcodes: ["622200001"] }], paymentMode: "cash", cashPaidCents: 0, idempotencyKey: crypto.randomUUID() } });
    expect(secondSale.statusCode).toBe(409);
  });

  it("returns exact serialized units to available or damaged and rejects reuse", async () => {
    const { sessionCookie, product, session } = await setup(2);
    for (const barcode of ["633300001", "633300002"])
      await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans`, headers: { cookie: sessionCookie }, payload: { barcode } });
    await app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/confirm`, headers: { cookie: sessionCookie } });
    await openRegister(sessionCookie);
    const sellUnit = (barcode: string) => app.inject({
      method: "POST", url: "/api/sales", headers: { cookie: sessionCookie },
      payload: { items: [{ productId: product.id, quantity: 1, unitBarcodes: [barcode] }], paymentMode: "cash", cashPaidCents: 0, idempotencyKey: crypto.randomUUID() },
    });
    const saleOne = await sellUnit("633300001"), saleTwo = await sellUnit("633300002");
    const unitRows = await database.sql`select barcode,sale_item_id from product_units where product_id=${product.id} order by barcode`;
    const returnUnit = (saleId: number, saleItemId: number, barcode: string, restock: boolean) => app.inject({
      method: "POST", url: "/api/returns", headers: { cookie: sessionCookie },
      payload: { saleId, items: [{ saleItemId, quantity: 1, restock, condition: restock ? "Bon état" : "Endommagée", unitBarcodes: [barcode] }], reason: "Retour unité sérialisée", idempotencyKey: crypto.randomUUID() },
    });
    const restocked = await returnUnit(saleOne.json().id, Number(unitRows[0]!.sale_item_id), "633300001", true);
    expect(restocked.statusCode, restocked.body).toBe(201);
    const duplicateReturn = await returnUnit(saleOne.json().id, Number(unitRows[0]!.sale_item_id), "633300001", true);
    expect(duplicateReturn.statusCode).toBe(409);
    const damaged = await returnUnit(saleTwo.json().id, Number(unitRows[1]!.sale_item_id), "633300002", false);
    expect(damaged.statusCode, damaged.body).toBe(201);
    const states = await database.sql`select barcode,status,return_id,returned_at,return_condition from product_units where product_id=${product.id} order by barcode`;
    expect(states[0]).toMatchObject({ barcode: "633300001", status: "available" });
    expect(states[0]!.return_id).toBeTruthy();
    expect(states[0]!.returned_at).toBeTruthy();
    expect(states[1]).toMatchObject({ barcode: "633300002", status: "damaged" });
    const resellDamaged = await sellUnit("633300002");
    expect(resellDamaged.statusCode).toBe(409);
  });

  it("validates a complete imported batch before inserting any scan", async () => {
    const { sessionCookie, session } = await setup(5);
    const send = (barcodes: string[]) => app.inject({ method: "POST", url: `/api/serialized-receiving/${session.id}/scans/batch`, headers: { cookie: sessionCookie }, payload: { barcodes } });
    expect((await send(["644400001", "x"])).statusCode).toBe(400);
    expect((await send(["644400001", "644400001"])).statusCode).toBe(409);
    let state = (await app.inject({ url: `/api/serialized-receiving/${session.id}`, headers: { cookie: sessionCookie } })).json();
    expect(state.scannedQuantity).toBe(0);
    const accepted = await send(["644400001", "644400002", "644400003"]);
    expect(accepted.statusCode, accepted.body).toBe(201);
    state = accepted.json();
    expect(state).toMatchObject({ scannedQuantity: 3, remainingQuantity: 2 });
  });

  it("protects the spreadsheet-safe serialized unit export", async () => {
    const { sessionCookie } = await setup(1);
    const exported = await app.inject({ url: "/api/serialized-units/export.csv", headers: { cookie: sessionCookie } });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.rawPayload[0]).toBe(0xef);
    expect((await app.inject({ url: "/api/serialized-units/export.csv" })).statusCode).toBe(401);
    const argon2 = (await import("argon2")).default;
    await database.sql`insert into users(full_name,username,password_hash,role,must_change_password) values('Caissier','serialcashier',${await argon2.hash("Secret123")},'cashier',false)`;
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "serialcashier", password: "Secret123" } });
    expect((await app.inject({ url: "/api/serialized-units/export.csv", headers: { cookie: cookie(login) } })).statusCode).toBe(403);
  });
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
      expect(r.json().desktopSession).toBeUndefined();
    }
  });
  it("returns lifecycle permissions for existing role-based users", async () => {
    await owner();
    const argon2 = (await import("argon2")).default;
    await database.sql`
      insert into users(full_name,username,password_hash,role,must_change_password) values
      ('Responsable','manager_existing',${await argon2.hash("Secret123")},'manager',false),
      ('Caissier','cashier_existing',${await argon2.hash("Secret123")},'cashier',false)
    `;
    const login = async (username: string) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: username, password: "Secret123" } });
      expect(response.statusCode, response.body).toBe(200);
      const profile = await app.inject({ url: "/api/auth/me", headers: { cookie: cookie(response) } });
      expect(profile.statusCode, profile.body).toBe(200);
      return profile.json().user.permissions as string[];
    };
    expect(await login("owner")).toEqual(expect.arrayContaining(["products.archive", "products.restore", "products.delete_permanently"]));
    const manager = await login("manager_existing");
    expect(manager).toEqual(expect.arrayContaining(["products.archive", "products.restore"]));
    expect(manager).not.toContain("products.delete_permanently");
    const cashier = await login("cashier_existing");
    expect(cashier).not.toContain("products.archive");
    expect(cashier).not.toContain("products.restore");
    expect(cashier).not.toContain("products.delete_permanently");
  });
  it("issues only a hashed, revocable desktop bearer session", async () => {
    await owner();
    const login = await app.inject({
      method: "POST", url: "/api/auth/login",
      headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop" },
      payload: { login: "owner", password: "Secret123" },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().desktopSession.token as string;
    expect(token).toHaveLength(43);
    const [stored] = await database.sql`select token_hash,session_type,expires_at from sessions where session_type='desktop'`;
    expect(stored!.token_hash).not.toBe(token);
    expect(new Date(String(stored!.expires_at)).getTime()).toBeGreaterThan(Date.now());
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
    await database.sql`update sessions set expires_at=now()-interval '1 minute' where session_type='desktop'`;
    const expired = await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().code).toBe("SESSION_EXPIRED");

    const second = await app.inject({
      method: "POST", url: "/api/auth/login",
      headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop" },
      payload: { login: "owner", password: "Secret123" },
    });
    const secondToken = second.json().desktopSession.token as string;
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { authorization: `Bearer ${secondToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${secondToken}` } })).statusCode).toBe(401);

    const third = await app.inject({
      method: "POST", url: "/api/auth/login",
      headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop" },
      payload: { login: "owner", password: "Secret123" },
    });
    const oldToken = third.json().desktopSession.token as string;
    const changed = await app.inject({
      method: "POST", url: "/api/auth/change-password",
      headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop", authorization: `Bearer ${oldToken}` },
      payload: { currentPassword: "Secret123", newPassword: "NouveauSecret456" },
    });
    expect(changed.statusCode).toBe(200);
    const replacement = changed.json().desktopSession.token as string;
    expect(replacement).not.toBe(oldToken);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${oldToken}` } })).json().code).toBe("SESSION_REVOKED");
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${replacement}` } })).statusCode).toBe(200);
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
  it("archives, hides, restores and permanently deletes only an unused product", async () => {
    const session = await phase2Owner();
    const cat = (await category(session)).json();
    const product = (await app.inject({ method: "POST", url: "/api/products", headers: { cookie: session }, payload: productBody(cat.id) })).json();

    const archived = await app.inject({ method: "POST", url: `/api/products/${product.id}/archive`, headers: { cookie: session } });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({ id: product.id, isActive: false });
    expect(archived.json().archivedAt).toBeTruthy();
    expect((await app.inject({ url: "/api/products?status=active", headers: { cookie: session } })).json().rows).toHaveLength(0);
    const archivedLookup = await app.inject({ url: `/api/products/lookup/${product.manufacturerBarcode}`, headers: { cookie: session } });
    expect(archivedLookup.statusCode).toBe(200);
    expect(archivedLookup.json().product.isActive).toBe(false);
    const saleLookup = await app.inject({ url: `/api/products/lookup/${product.manufacturerBarcode}?saleReady=true`, headers: { cookie: session } });
    expect(saleLookup.statusCode).toBe(409);
    expect(saleLookup.json().message).toContain("archivé");

    const restored = await app.inject({ method: "POST", url: `/api/products/${product.id}/restore`, headers: { cookie: session } });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ id: product.id, isActive: true, archivedAt: null, archivedBy: null });
    const [auditCounts] = await database.sql`select count(*) filter(where action='product.archived')::int archived,count(*) filter(where action='product.restored')::int restored from audit_logs where entity_id=${product.id}`;
    expect(auditCounts).toMatchObject({ archived: 1, restored: 1 });

    const deleted = await app.inject({ method: "DELETE", url: `/api/products/${product.id}`, headers: { cookie: session } });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(await database.sql`select id from products where id=${product.id}`).toHaveLength(0);
    const [deleteAudit] = await database.sql`select old_values_json from audit_logs where action='product.permanently_deleted' and entity_id=${product.id}`;
    expect(deleteAudit?.old_values_json).toContain(product.name);
  });

  it("blocks permanent deletion for stock or history and enforces lifecycle permissions", async () => {
    const session = await phase2Owner();
    const cat = (await category(session)).json();
    const stocked = (await app.inject({ method: "POST", url: "/api/products", headers: { cookie: session }, payload: productBody(cat.id, { initialQuantity: 1 }) })).json();
    const stockBlocked = await app.inject({ method: "DELETE", url: `/api/products/${stocked.id}`, headers: { cookie: session } });
    expect(stockBlocked.statusCode).toBe(409);
    expect(stockBlocked.json().message).toContain("stock");

    const historical = (await app.inject({ method: "POST", url: "/api/products", headers: { cookie: session }, payload: productBody(cat.id, { name: "Historique", sku: "HIST-1", manufacturerBarcode: "611000000099" }) })).json();
    await database.sql`insert into product_price_history(product_id,price_type,old_value_cents,new_value_cents,changed_by) values(${historical.id},'selling',100,200,1)`;
    const historyBlocked = await app.inject({ method: "DELETE", url: `/api/products/${historical.id}`, headers: { cookie: session } });
    expect(historyBlocked.statusCode).toBe(409);
    expect(historyBlocked.json().message).toContain("historique");

    const argon2 = (await import("argon2")).default;
    await database.sql`insert into users(full_name,username,password_hash,role,must_change_password) values('Responsable','manager_lifecycle',${await argon2.hash("Secret123")},'manager',false),('Caissier','cashier_lifecycle',${await argon2.hash("Secret123")},'cashier',false)`;
    const managerLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "manager_lifecycle", password: "Secret123" } });
    const cashierLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "cashier_lifecycle", password: "Secret123" } });
    const target = (await app.inject({ method: "POST", url: "/api/products", headers: { cookie: session }, payload: productBody(cat.id, { name: "Permissions", sku: "PERM-1", manufacturerBarcode: "611000000098" }) })).json();
    expect((await app.inject({ method: "POST", url: `/api/products/${target.id}/archive`, headers: { cookie: cookie(managerLogin) } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/products/${target.id}/restore`, headers: { cookie: cookie(managerLogin) } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/products/${target.id}`, headers: { cookie: cookie(managerLogin) } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/products/${target.id}/archive`, headers: { cookie: cookie(cashierLogin) } })).statusCode).toBe(403);
  });
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
    expect(first.json().internalBarcode).toBe("MKT000000001");
    expect(first.json().qrIdentifier).toBe("MKT-P-MKT000000001");
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
      "MKT000000001",
      "MKT000000002",
      "MKT000000003",
      "MKT000000004",
      "MKT000000005",
    ]);
  });
  it("reserves unique internal barcodes through the protected generator", async () => {
    const session = await phase2Owner();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({
        method: "POST",
        url: "/api/products/barcodes/generate",
        headers: { cookie: session },
      })),
    );
    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    const codes = responses.map((response) => response.json().barcode);
    expect(new Set(codes).size).toBe(5);
    expect(codes.every((code) => /^MKT\d{9}$/.test(code))).toBe(true);
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
  it("creates initial stock atomically and receives arbitrary quantities idempotently", async () => {
    const session = await phase2Owner(),
      cat = (await category(session)).json(),
      created = await app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie: session },
        payload: productBody(cat.id, { initialQuantity: 7 }),
      });
    expect(created.statusCode).toBe(201);
    expect(created.json().currentStock).toBe(7);
    const productId = created.json().id;
    for (const [index, quantity] of [1, 5, 24, 50].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/stock/receipts",
        headers: { cookie: session },
        payload: { productId, quantity, idempotencyKey: `receipt-${productId}-${index}` },
      });
      expect(response.statusCode).toBe(201);
    }
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/stock/receipts",
      headers: { cookie: session },
      payload: { productId, quantity: 99, idempotencyKey: `receipt-${productId}-0` },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ duplicate: true, quantityAdded: 1, newStock: 8 });
    const [stored] = await database.sql`select current_stock from products where id=${productId}`;
    expect(stored!.current_stock).toBe(87);
    const [movementCount] = await database.sql`select count(*)::int count from stock_movements where product_id=${productId}`;
    expect(movementCount!.count).toBe(5);
    const [auditCount] = await database.sql`select count(*)::int count from audit_logs where entity_id=${productId} and action in ('stock.initialized','stock.received')`;
    expect(auditCount!.count).toBe(5);
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

async function phase4Supplier(session: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/suppliers",
    headers: { cookie: session },
    payload: { name: "Atlas Distribution", phone: "+212600000001" },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe("online suppliers, purchases, expenses and returns", () => {
  it("records an idempotent credit purchase, stock, price and supplier ledger", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 2),
      supplier = await phase4Supplier(session),
      key = crypto.randomUUID(),
      purchase = () =>
        app.inject({
          method: "POST",
          url: "/api/purchases",
          headers: { cookie: session },
          payload: {
            supplierId: supplier.id,
            items: [
              {
                productId: product.id,
                quantity: 3,
                purchaseUnitPriceCents: 425,
              },
            ],
            paymentMode: "credit",
            paymentSource: "external_cash",
            idempotencyKey: key,
          },
        });
    const results = await Promise.all([purchase(), purchase()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    const [stock] =
        await database.sql`select current_stock,purchase_price_cents from products where id=${product.id}`,
      [debt] =
        await database.sql`select current_debt_cents from suppliers where id=${supplier.id}`,
      ledger = await app.inject({
        url: `/api/suppliers/${supplier.id}/ledger`,
        headers: { cookie: session },
      });
    expect(Number(stock!.current_stock)).toBe(5);
    expect(Number(stock!.purchase_price_cents)).toBe(425);
    expect(Number(debt!.current_debt_cents)).toBe(1275);
    expect(ledger.json().rows[0].transactionType).toBe("purchase_credit");
  });

  it("pays supplier debt and prevents concurrent overpayment", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session),
      supplier = await phase4Supplier(session);
    await app.inject({
      method: "POST",
      url: "/api/purchases",
      headers: { cookie: session },
      payload: {
        supplierId: supplier.id,
        items: [
          { productId: product.id, quantity: 1, purchaseUnitPriceCents: 1000 },
        ],
        paymentMode: "credit",
        paymentSource: "external_cash",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const pay = () =>
      app.inject({
        method: "POST",
        url: `/api/suppliers/${supplier.id}/payments`,
        headers: { cookie: session },
        payload: {
          amountCents: 700,
          paymentSource: "external_cash",
          idempotencyKey: crypto.randomUUID(),
        },
      });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const [row] =
      await database.sql`select current_debt_cents from suppliers where id=${supplier.id}`;
    expect(Number(row!.current_debt_cents)).toBe(300);
  });

  it("creates and immutably corrects a register expense idempotently", async () => {
    const session = await phase2Owner();
    await openRegister(session);
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: { cookie: session },
      payload: {
        category: "Transport",
        description: "Livraison urgente",
        amountCents: 2500,
        paymentSource: "cash_register",
        expenseDate: "2026-07-16",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(created.statusCode).toBe(201);
    const key = crypto.randomUUID(),
      correct = () =>
        app.inject({
          method: "POST",
          url: `/api/expenses/${created.json().id}/correct`,
          headers: { cookie: session },
          payload: {
            reason: "Facture fournisseur annulée",
            idempotencyKey: key,
          },
        });
    const first = await correct(),
      duplicate = await correct();
    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    const rows =
      await database.sql`select amount_cents,status,correction_of_id from expenses order by id`;
    expect(rows.map((r) => Number(r.amount_cents))).toEqual([2500, -2500]);
    expect(rows[0]!.status).toBe("corrected");
    expect(Number(rows[1]!.correction_of_id)).toBe(created.json().id);
  });

  it("allocates a partial-sale return credit-first and restocks only when requested", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 3),
      customer = await phase3Customer(session);
    await openRegister(session);
    const saleResponse = await createSale(session, product.id, {
      customerId: customer.id,
      paymentMode: "partial",
      cashPaidCents: 500,
    });
    expect(saleResponse.statusCode).toBe(201);
    const sale = saleResponse.json(),
      detail = await app.inject({
        url: `/api/sales/${sale.id}`,
        headers: { cookie: session },
      }),
      saleItem = detail.json().items[0];
    const returned = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: { cookie: session },
      payload: {
        saleId: sale.id,
        items: [{ saleItemId: saleItem.id, quantity: 1, restock: true }],
        reason: "Article défectueux",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(returned.statusCode).toBe(201);
    expect(returned.json()).toMatchObject({
      totalCents: 1250,
      debtReductionCents: 750,
      cashRefundCents: 500,
    });
    const [stock] =
        await database.sql`select current_stock from products where id=${product.id}`,
      [debt] =
        await database.sql`select current_debt_cents from customers where id=${customer.id}`;
    expect(Number(stock!.current_stock)).toBe(3);
    expect(Number(debt!.current_debt_cents)).toBe(0);
  });

  it("allows only one concurrent return of the same sold quantity", async () => {
    const session = await phase2Owner(),
      product = await phase3Product(session, 1);
    await openRegister(session);
    const sale = (await createSale(session, product.id)).json(),
      detail = await app.inject({
        url: `/api/sales/${sale.id}`,
        headers: { cookie: session },
      }),
      item = detail.json().items[0];
    const submit = () =>
      app.inject({
        method: "POST",
        url: "/api/returns",
        headers: { cookie: session },
        payload: {
          saleId: sale.id,
          items: [{ saleItemId: item.id, quantity: 1, restock: false }],
          reason: "Retour concurrent",
          idempotencyKey: crypto.randomUUID(),
        },
      });
    const results = await Promise.all([submit(), submit()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it("keeps Phase 4 list endpoints responsive", async () => {
    const session = await phase2Owner(),
      urls = [
        "/api/suppliers",
        "/api/purchases",
        "/api/expenses",
        "/api/returns",
      ],
      timings: Record<string, number> = {};
    for (const url of urls) {
      const start = performance.now(),
        response = await app.inject({ url, headers: { cookie: session } });
      timings[url] = Number((performance.now() - start).toFixed(2));
      expect(response.statusCode).toBe(200);
      expect(timings[url]).toBeLessThan(1000);
    }
    console.info("PHASE4_TIMINGS_MS", timings);
  });
});

describe("online administration, reports, exports and settings", () => {
  it("manages an employee safely and revokes sessions after password reset", async () => {
    const admin = await phase2Owner(),
      created = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: { cookie: admin },
        payload: {
          displayName: "Caissier Test",
          username: "cashier5",
          email: "cashier5@example.com",
          role: "cashier",
          password: "1",
        },
      });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("temporaryPassword");
    expect(JSON.stringify(created.json())).not.toContain("passwordHash");
    const id = created.json().user.id,
      login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          login: "cashier5",
          password: "1",
        },
      });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.mustChangePassword).toBe(true);
    const desktopLogin = await app.inject({
      method: "POST", url: "/api/auth/login",
      headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop" },
      payload: { login: "cashier5", password: "1" },
    });
    const desktopToken = desktopLogin.json().desktopSession.token as string,
      workerCookie = cookie(login),
      blocked = await app.inject({
        url: "/api/products",
        headers: { cookie: workerCookie },
      });
    expect(blocked.statusCode).toBe(403);
    const reset = await app.inject({
      method: "POST",
      url: `/api/users/${id}/reset-password`,
      headers: { cookie: admin },
      payload: { confirmation: true, password: "0" },
    });
    expect(reset.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { cookie: workerCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${desktopToken}` } })).json().code).toBe("SESSION_REVOKED");
    const relogin = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: "http://tauri.localhost", "x-maktaba-client": "tauri-desktop" },
          payload: {
            login: "cashier5",
            password: "0",
          },
        });
    expect(relogin.statusCode).toBe(200);
    const replacementToken = relogin.json().desktopSession.token as string;
    expect((await app.inject({ method: "POST", url: `/api/users/${id}/deactivate`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${replacementToken}` } })).json().code).toBe("SESSION_REVOKED");
    const audit = await app.inject({
      url: "/api/audit-logs?action=user.password_reset",
      headers: { cookie: admin },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().rows[0].metadata).not.toHaveProperty("password");
  });

  it("rejects duplicate identities and protects the final global administrator", async () => {
    const admin = await phase2Owner(),
      payload = {
        displayName: "Manager",
        username: "manager5",
        email: "manager5@example.com",
        role: "manager",
        password: "1",
      };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/users",
          headers: { cookie: admin },
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/users",
          headers: { cookie: admin },
          payload: {
            ...payload,
            displayName: "Duplicate",
            email: "other@example.com",
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/users/1/deactivate",
          headers: { cookie: admin },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("runs every bounded report and enforces profit restrictions", async () => {
    const admin = await phase2Owner(),
      product = await phase3Product(admin, 3),
      customer = await phase3Customer(admin);
    await openRegister(admin);
    await createSale(admin, product.id, {
      customerId: customer.id,
      paymentMode: "partial",
      cashPaidCents: 500,
    });
    for (const kind of [
      "sales",
      "profit",
      "stock",
      "customers",
      "suppliers",
      "expenses",
      "workers",
      "registers",
    ]) {
      const response = await app.inject({
        url: `/api/reports/${kind}?preset=today&pageSize=10`,
        headers: { cookie: admin },
      });
      expect(response.statusCode, `${kind}: ${response.body}`).toBe(200);
      expect(response.json().pageSize).toBe(10);
    }
    const argon2 = (await import("argon2")).default;
    await database.sql`insert into users(full_name,username,password_hash,role,must_change_password) values('Caissier','reportcash',${await argon2.hash("Secret123")},'cashier',false)`;
    const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { login: "reportcash", password: "Secret123" },
      }),
      restricted = cookie(login);
    expect(
      (
        await app.inject({
          url: "/api/reports/profit",
          headers: { cookie: restricted },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/reports/sales",
          headers: { cookie: restricted },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("streams spreadsheet-safe CSV with BOM, semicolons and CRLF", async () => {
    const admin = await phase2Owner();
    await database.sql`insert into customers(full_name,notes,created_by) values('=2+2','@unsafe',1)`;
    const response = await app.inject({
      url: "/api/exports/customers.csv?preset=today",
      headers: { cookie: admin },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.rawPayload[0]).toBe(0xef);
    expect(response.body).toContain(";");
    expect(response.body).toContain("\r\n");
    expect(response.body).toContain("'=2+2");
    expect(response.body).not.toContain("password_hash");
    const [audit] =
      await database.sql`select count(*)::int count from audit_logs where action='export.created'`;
    expect(audit!.count).toBe(1);
  });

  it("updates safe settings without changing existing identifiers", async () => {
    const admin = await phase2Owner(),
      product = await phase3Product(admin);
    const current = (
      await app.inject({ url: "/api/settings", headers: { cookie: admin } })
    ).json();
    const update = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie: admin },
      payload: {
        ...current,
        barcodePrefix: "NEW",
        timezone: "Africa/Casablanca",
        receiptWidth: 58,
        labelSize: "50x30",
      },
    });
    expect(update.statusCode).toBe(200);
    const [stored] =
      await database.sql`select internal_barcode from products where id=${product.id}`;
    expect(stored!.internal_barcode).toBe(product.internalBarcode);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/settings",
          headers: { cookie: admin },
          payload: { ...current, timezone: "Not/AZone" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("creates and verifies a native PostgreSQL backup and rejects unauthorized restore", async () => {
    const admin = await phase2Owner(),
      created = await app.inject({
        method: "POST",
        url: "/api/backups",
        headers: { cookie: admin },
      });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().checksumSha256).toHaveLength(64);
    const verified = await app.inject({
      method: "POST",
      url: `/api/backups/${created.json().id}/verify`,
      headers: { cookie: admin },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const argon2 = (await import("argon2")).default;
    await database.sql`insert into users(full_name,username,password_hash,role,must_change_password) values('Manager','backupmanager',${await argon2.hash("Secret123")},'manager',false)`;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: "backupmanager", password: "Secret123" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/backups/${created.json().id}/restore`,
          headers: { cookie: cookie(login) },
          payload: { confirmation: "RESTORE" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/backups/${created.json().id}/restore`,
          headers: { cookie: admin },
          payload: { confirmation: "wrong" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
