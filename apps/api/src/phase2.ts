import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  or,
  sql as raw,
  lte,
  gte,
} from "drizzle-orm";
import {
  categoryCreateSchema,
  categoryFiltersSchema,
  categoryUpdateSchema,
  idParamSchema,
  identifierLookupSchema,
  productCreateSchema,
  productFiltersSchema,
  productUpdateSchema,
  quickStockReceiptSchema,
  stockAdjustmentSchema,
  stockFiltersSchema,
  stockMovementFiltersSchema,
  barcodeValueSchema,
  barcodeResolveQuerySchema,
  bookDuplicateQuerySchema,
} from "@maktaba/validation";
import { db } from "./db/index.js";
import {
  appSettings,
  auditLogs,
  categories,
  products,
  productPriceHistory,
  productUnits,
  purchaseItems,
  returnItems,
  saleItems,
  serializedReceivingSessions,
  stockMovements,
  users,
} from "./db/schema.js";
import { requirePermission } from "./auth.js";
const bad = (
  r: FastifyReply,
  id: string,
  fieldErrors?: Record<string, string[] | undefined>,
) =>
  r.code(400).send({
    code: "VALIDATION_ERROR",
    message: "Vérifiez les informations saisies.",
    fieldErrors,
    requestId: id,
  });
const absent = (r: FastifyReply, id: string, message: string) =>
  r.code(404).send({ code: "NOT_FOUND", message, requestId: id });
const clash = (r: FastifyReply, id: string, message: string) =>
  r.code(409).send({ code: "CONFLICT", message, requestId: id });
const paging = (page: number, pageSize: number, totalRows: number) => ({
  page,
  pageSize,
  totalRows,
  totalPages: Math.ceil(totalRows / pageSize),
});
const unique = (e: unknown): boolean =>
  !!e &&
  typeof e === "object" &&
  (("code" in e && (e as { code: string }).code === "23505") ||
    ("cause" in e && unique((e as { cause: unknown }).cause)));
const canCost = (req: FastifyRequest) =>
  ["global_admin", "manager", "stock_worker"].includes(req.user!.role);
const safe = <
  T extends {
    purchasePriceCents: number;
    currentStock: number;
    minimumStock: number;
    trackStock: boolean;
  },
>(
  req: FastifyRequest,
  p: T,
) => {
  const value = {
    ...p,
    isLowStock: p.trackStock && p.currentStock <= p.minimumStock,
    isOutOfStock: p.trackStock && p.currentStock === 0,
  };
  if (canCost(req)) return value;
  const rest: Partial<typeof value> = { ...value };
  delete rest.purchasePriceCents;
  return rest;
};
const pf = {
  id: products.id,
  categoryId: products.categoryId,
  categoryName: categories.name,
  name: products.name,
  description: products.description,
  author: products.author,
  isbn10: products.isbn10,
  isbn13: products.isbn13,
  publisher: products.publisher,
  publicationYear: products.publicationYear,
  bookLanguage: products.bookLanguage,
  productType: products.productType,
  inventoryMode: products.inventoryMode,
  sku: products.sku,
  manufacturerBarcode: products.manufacturerBarcode,
  internalBarcode: products.internalBarcode,
  qrIdentifier: products.qrIdentifier,
  purchasePriceCents: products.purchasePriceCents,
  sellingPriceCents: products.sellingPriceCents,
  wholesalePriceCents: products.wholesalePriceCents,
  wholesaleMinQuantity: products.wholesaleMinQuantity,
  currentStock: products.currentStock,
  minimumStock: products.minimumStock,
  unit: products.unit,
  shelfLocation: products.shelfLocation,
  isActive: products.isActive,
  archivedAt: products.archivedAt,
  archivedBy: products.archivedBy,
  canDeletePermanently: raw<boolean>`(
    ${products.currentStock} = 0
    and not exists (select 1 from ${saleItems} where ${saleItems.productId} = ${products.id})
    and not exists (select 1 from ${purchaseItems} where ${purchaseItems.productId} = ${products.id})
    and not exists (select 1 from ${returnItems} where ${returnItems.productId} = ${products.id})
    and not exists (select 1 from ${stockMovements} where ${stockMovements.productId} = ${products.id})
    and not exists (select 1 from ${productPriceHistory} where ${productPriceHistory.productId} = ${products.id})
    and not exists (select 1 from ${productUnits} where ${productUnits.productId} = ${products.id})
    and not exists (select 1 from ${serializedReceivingSessions} where ${serializedReceivingSessions.productId} = ${products.id})
  )`.as("can_delete_permanently"),
  trackStock: products.trackStock,
  createdBy: products.createdBy,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};
export async function registerPhase2(app: FastifyInstance) {
  app.get(
    "/api/products/resolve-barcode",
    { preHandler: requirePermission("products.view") },
    async (req, reply) => {
      const parsed = barcodeResolveQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return bad(reply, req.id, parsed.error.flatten().fieldErrors);
      const normalizedCode = parsed.data.code
        .replace(/[\r\n\t]+$/u, "")
        .trim();
      const comparableCode = normalizedCode.toLocaleLowerCase("en-US");
      const compactIsbn = normalizedCode.replace(/[\s-]/gu, "").toUpperCase();

      const unitRows = await db
        .select({
          unitId: productUnits.id,
          unitBarcode: productUnits.barcode,
          unitStatus: productUnits.status,
          product: pf,
        })
        .from(productUnits)
        .innerJoin(products, eq(productUnits.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          raw`lower(trim(${productUnits.barcode})) = ${comparableCode}`,
        );
      const productRows = await db
        .select(pf)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          or(
            raw`lower(trim(${products.manufacturerBarcode})) = ${comparableCode}`,
            raw`lower(trim(${products.internalBarcode})) = ${comparableCode}`,
            raw`upper(replace(replace(trim(${products.isbn13}), '-', ''), ' ', '')) = ${compactIsbn}`,
            raw`upper(replace(replace(trim(${products.isbn10}), '-', ''), ' ', '')) = ${compactIsbn}`,
          ),
        );

      const productIds = new Set<number>([
        ...unitRows.map((row) => row.product.id),
        ...productRows.map((row) => row.id),
      ]);
      if (productIds.size === 0)
        return absent(reply, req.id, "Aucun produit ne correspond au code-barres scanné.");
      if (productIds.size > 1)
        return reply.code(409).send({
          code: "BARCODE_CONFLICT",
          message: "Ce code-barres correspond à plusieurs produits.",
          requestId: req.id,
        });

      const unitRow = unitRows[0];
      const product = unitRow?.product ?? productRows[0]!;
      if (!product.isActive)
        return reply.code(409).send({
          code: "PRODUCT_INACTIVE",
          message: "Ce produit est inactif.",
          requestId: req.id,
        });
      let matchType:
        | "serialized_unit"
        | "original_barcode"
        | "generated_barcode"
        | "isbn13"
        | "isbn10" = "generated_barcode";
      if (unitRow) matchType = "serialized_unit";
      else if (product.manufacturerBarcode?.trim().toLocaleLowerCase("en-US") === comparableCode)
        matchType = "original_barcode";
      else if (product.internalBarcode.trim().toLocaleLowerCase("en-US") === comparableCode)
        matchType = "generated_barcode";
      else if (product.isbn13?.replace(/[\s-]/gu, "").toUpperCase() === compactIsbn)
        matchType = "isbn13";
      else if (product.isbn10?.replace(/[\s-]/gu, "").toUpperCase() === compactIsbn)
        matchType = "isbn10";

      return {
        matchType,
        normalizedCode:
          matchType === "isbn10" || matchType === "isbn13"
            ? compactIsbn
            : normalizedCode,
        product: safe(req, product),
        unit: unitRow
          ? {
              id: unitRow.unitId,
              barcode: unitRow.unitBarcode,
              status: unitRow.unitStatus,
            }
          : null,
      };
    },
  );
  app.get(
    "/api/products/book-duplicates",
    { preHandler: requirePermission("products.use_book_assistant") },
    async (req, reply) => {
      const parsed = bookDuplicateQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return bad(reply, req.id, parsed.error.flatten().fieldErrors);
      const value = parsed.data;
      const rows = await db
        .select(pf)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          or(
            value.isbn10
              ? raw`lower(trim(${products.isbn10}))=${value.isbn10.toLowerCase()}`
              : undefined,
            value.isbn13
              ? raw`lower(trim(${products.isbn13}))=${value.isbn13.toLowerCase()}`
              : undefined,
            value.title
              ? and(
                  ilike(products.name, value.title),
                  value.author
                    ? ilike(products.author, value.author)
                    : undefined,
                )
              : undefined,
          ),
        )
        .limit(10);
      return { rows: rows.map((row) => safe(req, row)) };
    },
  );
  app.get(
    "/api/categories",
    { preHandler: requirePermission("categories.view") },
    async (req, reply) => {
      const p = categoryFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, req.id, p.error.flatten().fieldErrors);
      const q = p.data,
        w = and(
          q.search ? ilike(categories.name, `%${q.search}%`) : undefined,
          q.status === "active"
            ? eq(categories.isActive, true)
            : q.status === "inactive"
              ? eq(categories.isActive, false)
              : undefined,
        ),
        column =
          q.sort === "createdAt"
            ? categories.createdAt
            : q.sort === "updatedAt"
              ? categories.updatedAt
              : categories.name,
        rows = await db
          .select({
            id: categories.id,
            name: categories.name,
            description: categories.description,
            isActive: categories.isActive,
            createdBy: categories.createdBy,
            createdAt: categories.createdAt,
            updatedAt: categories.updatedAt,
            productCount: raw<number>`count(${products.id})::int`,
          })
          .from(categories)
          .leftJoin(products, eq(products.categoryId, categories.id))
          .where(w)
          .groupBy(categories.id)
          .orderBy(q.direction === "desc" ? desc(column) : asc(column))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        [total] = await db
          .select({ n: raw<number>`count(*)::int` })
          .from(categories)
          .where(w);
      return { ...paging(q.page, q.pageSize, total?.n ?? 0), rows };
    },
  );
  app.post(
    "/api/categories",
    { preHandler: requirePermission("categories.manage") },
    async (req, reply) => {
      const p = categoryCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, req.id, p.error.flatten().fieldErrors);
      try {
        const result = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(categories)
            .values({
              ...p.data,
              description: p.data.description || null,
              createdBy: req.user!.id,
            })
            .returning();
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "category.created",
            entityType: "category",
            entityId: row!.id,
            newValuesJson: JSON.stringify(p.data),
          });
          return row!;
        });
        return reply.code(201).send(result);
      } catch (e) {
        if (unique(e))
          return clash(
            reply,
            req.id,
            "Une catégorie portant ce nom existe déjà.",
          );
        throw e;
      }
    },
  );
  app.get(
    "/api/categories/:id",
    { preHandler: requirePermission("categories.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, req.id);
      const [row] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, p.data.id))
        .limit(1);
      return row ?? absent(reply, req.id, "Catégorie introuvable.");
    },
  );
  app.patch(
    "/api/categories/:id",
    { preHandler: requirePermission("categories.manage") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = categoryUpdateSchema.safeParse(req.body);
      if (!id.success || !p.success)
        return bad(
          reply,
          req.id,
          p.success ? undefined : p.error.flatten().fieldErrors,
        );
      try {
        const result = await db.transaction(async (tx) => {
          const [old] = await tx
            .select()
            .from(categories)
            .where(eq(categories.id, id.data.id))
            .limit(1);
          if (!old) return null;
          const [row] = await tx
            .update(categories)
            .set({
              ...p.data,
              description: p.data.description || null,
              updatedAt: new Date(),
            })
            .where(eq(categories.id, id.data.id))
            .returning();
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "category.updated",
            entityType: "category",
            entityId: id.data.id,
            oldValuesJson: JSON.stringify(old),
            newValuesJson: JSON.stringify(p.data),
          });
          return row!;
        });
        return result ?? absent(reply, req.id, "Catégorie introuvable.");
      } catch (e) {
        if (unique(e))
          return clash(
            reply,
            req.id,
            "Une catégorie portant ce nom existe déjà.",
          );
        throw e;
      }
    },
  );
  for (const active of [true, false])
    app.post(
      `/api/categories/:id/${active ? "activate" : "deactivate"}`,
      { preHandler: requirePermission("categories.manage") },
      async (req, reply) => {
        const p = idParamSchema.safeParse(req.params);
        if (!p.success) return bad(reply, req.id);
        return db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(categories)
            .where(eq(categories.id, p.data.id))
            .limit(1);
          if (!row) return absent(reply, req.id, "Catégorie introuvable.");
          if (!active) {
            const [used] = await tx
              .select({ n: raw<number>`count(*)::int` })
              .from(products)
              .where(
                and(
                  eq(products.categoryId, row.id),
                  eq(products.isActive, true),
                ),
              );
            if (used!.n > 0)
              return clash(
                reply,
                req.id,
                "Impossible de désactiver cette catégorie : des produits actifs en dépendent.",
              );
          }
          const [changed] = await tx
            .update(categories)
            .set({ isActive: active, updatedAt: new Date() })
            .where(eq(categories.id, row.id))
            .returning();
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: `category.${active ? "activated" : "deactivated"}`,
            entityType: "category",
            entityId: row.id,
          });
          return changed!;
        });
      },
    );
  app.get(
    "/api/products",
    { preHandler: requirePermission("products.view") },
    async (req, reply) => {
      const p = productFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, req.id, p.error.flatten().fieldErrors);
      const q = p.data,
        search = q.search
          ? or(
              ilike(products.name, `%${q.search}%`),
              ilike(products.sku, `%${q.search}%`),
              ilike(products.manufacturerBarcode, `%${q.search}%`),
              ilike(products.internalBarcode, `%${q.search}%`),
              ilike(products.qrIdentifier, `%${q.search}%`),
              ilike(products.shelfLocation, `%${q.search}%`),
            )
          : undefined,
        w = and(
          search,
          q.categoryId ? eq(products.categoryId, q.categoryId) : undefined,
          q.productType ? eq(products.productType, q.productType) : undefined,
          q.status === "active"
            ? eq(products.isActive, true)
            : q.status === "inactive"
              ? eq(products.isActive, false)
              : undefined,
          q.lowStockOnly
            ? and(
                eq(products.trackStock, true),
                lte(products.currentStock, products.minimumStock),
              )
            : undefined,
          q.outOfStockOnly
            ? and(eq(products.trackStock, true), eq(products.currentStock, 0))
            : undefined,
        ),
        column =
          q.sort === "createdAt"
            ? products.createdAt
            : q.sort === "sellingPriceCents"
              ? products.sellingPriceCents
              : q.sort === "currentStock"
                ? products.currentStock
                : products.name,
        rows = await db
          .select(pf)
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(w)
          .orderBy(q.direction === "desc" ? desc(column) : asc(column))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        [total] = await db
          .select({ n: raw<number>`count(*)::int` })
          .from(products)
          .where(w);
      return {
        ...paging(q.page, q.pageSize, total?.n ?? 0),
        rows: rows.map((x) => safe(req, x)),
      };
    },
  );
  app.post(
    "/api/products/barcodes/generate",
    { preHandler: requirePermission("products.create") },
    async (req, reply) => {
      const result = await db.transaction(async (tx) => {
        const [setting] = await tx
          .update(appSettings)
          .set({
            nextBarcodeSequence: raw`${appSettings.nextBarcodeSequence}+1`,
            updatedAt: new Date(),
          })
          .where(eq(appSettings.id, 1))
          .returning({
            prefix: appSettings.barcodePrefix,
            next: appSettings.nextBarcodeSequence,
          });
        if (!setting) throw new Error("settings missing");
        const prefix = setting.prefix.trim().toUpperCase();
        const barcode = `${prefix}${String(setting.next - 1).padStart(9, "0")}`;
        if (!barcodeValueSchema.safeParse(barcode).success)
          throw new Error("invalid barcode configuration");
        await tx.insert(auditLogs).values({
          userId: req.user!.id,
          action: "product.internal_barcode.generated",
          entityType: "product_barcode",
          newValuesJson: JSON.stringify({ barcode }),
        });
        return barcode;
      });
      return reply.code(201).send({ barcode: result });
    },
  );
  app.post(
    "/api/products",
    { preHandler: requirePermission("products.create") },
    async (req, reply) => {
      const p = productCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, req.id, p.error.flatten().fieldErrors);
      try {
        const result = await db.transaction(async (tx) => {
          const [category] = await tx
            .select()
            .from(categories)
            .where(
              and(
                eq(categories.id, p.data.categoryId),
                eq(categories.isActive, true),
              ),
            )
            .limit(1);
          if (!category) throw Object.assign(new Error(), { kind: "category" });
          const [setting] = await tx
            .update(appSettings)
            .set({
              nextBarcodeSequence: raw`${appSettings.nextBarcodeSequence}+1`,
              updatedAt: new Date(),
            })
            .where(eq(appSettings.id, 1))
            .returning({
              prefix: appSettings.barcodePrefix,
              next: appSettings.nextBarcodeSequence,
            });
          if (!setting) throw new Error("settings missing");
          const { initialQuantity, ...productInput } = p.data;
          const internal = `${setting.prefix.trim().toUpperCase()}${String(setting.next - 1).padStart(9, "0")}`,
            qr = `${setting.prefix}-P-${internal}`,
            [row] = await tx
              .insert(products)
              .values({
                ...productInput,
                description: p.data.description || null,
                sku: p.data.sku || null,
                manufacturerBarcode: p.data.manufacturerBarcode || null,
                shelfLocation: p.data.shelfLocation || null,
                internalBarcode: internal,
                qrIdentifier: qr,
                currentStock: initialQuantity,
                createdBy: req.user!.id,
              })
              .returning();
          if (initialQuantity > 0) {
            const [movement] = await tx.insert(stockMovements).values({
              productId: row!.id,
              movementType: "opening_stock",
              quantityChange: initialQuantity,
              stockBefore: 0,
              stockAfter: initialQuantity,
              reason: "Stock initial lors de la création du produit",
              createdBy: req.user!.id,
            }).returning({ id: stockMovements.id });
            await tx.insert(auditLogs).values({
              userId: req.user!.id,
              action: "stock.initialized",
              entityType: "product",
              entityId: row!.id,
              newValuesJson: JSON.stringify({ stock: initialQuantity, movementId: movement!.id }),
            });
          }
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "product.created",
            entityType: "product",
            entityId: row!.id,
            newValuesJson: JSON.stringify({
              name: row!.name,
              internalBarcode: internal,
              initialQuantity,
            }),
          });
          return row!;
        });
        return reply
          .code(201)
          .send(safe(req, { ...result, categoryName: null }));
      } catch (e) {
        if (unique(e))
          return clash(reply, req.id, "Le SKU ou le code-barres existe déjà.");
        if ((e as { kind?: string }).kind === "category")
          return clash(
            reply,
            req.id,
            "La catégorie doit exister et être active.",
          );
        throw e;
      }
    },
  );
  app.get(
    "/api/products/lookup/:code",
    { preHandler: requirePermission("products.view") },
    async (req, reply) => {
      const p = identifierLookupSchema.safeParse({
        ...(req.params as object),
        ...(req.query as object),
      });
      if (!p.success) return bad(reply, req.id);
      const [row] = await db
        .select(pf)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          or(
            eq(products.manufacturerBarcode, p.data.code),
            eq(products.internalBarcode, p.data.code),
            eq(products.qrIdentifier, p.data.code),
            eq(products.sku, p.data.code),
          ),
        )
        .limit(1);
      if (!row) return absent(reply, req.id, "Produit introuvable.");
      if (p.data.saleReady && !row.isActive)
        return clash(reply, req.id, "Ce produit est archivé et ne peut pas être vendu.");
      return { product: safe(req, row) };
    },
  );
  app.get(
    "/api/products/:id",
    { preHandler: requirePermission("products.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, req.id);
      const [row] = await db
        .select(pf)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(eq(products.id, p.data.id))
        .limit(1);
      return row
        ? safe(req, row)
        : absent(reply, req.id, "Produit introuvable.");
    },
  );
  app.patch(
    "/api/products/:id",
    { preHandler: requirePermission("products.edit") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = productUpdateSchema.safeParse(req.body);
      if (!id.success || !p.success)
        return bad(
          reply,
          req.id,
          p.success ? undefined : p.error.flatten().fieldErrors,
        );
      try {
        const result = await db.transaction(async (tx) => {
          const [old] = await tx
            .select()
            .from(products)
            .where(eq(products.id, id.data.id))
            .limit(1);
          if (!old) return null;
          if (p.data.categoryId) {
            const [cat] = await tx
              .select()
              .from(categories)
              .where(
                and(
                  eq(categories.id, p.data.categoryId),
                  eq(categories.isActive, true),
                ),
              )
              .limit(1);
            if (!cat) throw Object.assign(new Error(), { kind: "category" });
          }
          if (p.data.productType === "service" && old.currentStock !== 0)
            throw Object.assign(new Error(), { kind: "service_has_stock" });
          if (p.data.inventoryMode !== undefined && p.data.inventoryMode !== old.inventoryMode)
            throw Object.assign(new Error(), { kind: "inventory_mode_locked" });
          const willBeService =
              p.data.productType === "service" ||
              (p.data.productType === undefined &&
                old.productType === "service"),
            values = willBeService
              ? {
                  ...p.data,
                  trackStock: false,
                  minimumStock: 0,
                  currentStock: 0,
                }
              : p.data,
            [row] = await tx
              .update(products)
              .set({
                ...values,
                description:
                  values.description === undefined
                    ? undefined
                    : values.description || null,
                sku: values.sku === undefined ? undefined : values.sku || null,
                manufacturerBarcode:
                  values.manufacturerBarcode === undefined
                    ? undefined
                    : values.manufacturerBarcode || null,
                shelfLocation:
                  values.shelfLocation === undefined
                    ? undefined
                    : values.shelfLocation || null,
                updatedAt: new Date(),
              })
              .where(eq(products.id, id.data.id))
              .returning();
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "product.updated",
            entityType: "product",
            entityId: id.data.id,
            oldValuesJson: JSON.stringify(old),
            newValuesJson: JSON.stringify(p.data),
          });
          return row!;
        });
        if (!result) return absent(reply, req.id, "Produit introuvable.");
        return safe(req, { ...result, categoryName: null });
      } catch (e) {
        if (unique(e))
          return clash(reply, req.id, "Le SKU ou le code-barres existe déjà.");
        if ((e as { kind?: string }).kind === "category")
          return clash(
            reply,
            req.id,
            "La catégorie doit exister et être active.",
          );
        if ((e as { kind?: string }).kind === "service_has_stock")
          return clash(
            reply,
            req.id,
            "Impossible de convertir un produit avec du stock en service.",
          );
        if ((e as { kind?: string }).kind === "inventory_mode_locked")
          return clash(
            reply,
            req.id,
            "Le mode de stock d’un produit existant ne peut pas être modifié.",
          );
        throw e;
      }
    },
  );
  app.post("/api/products/:id/archive", { preHandler: requirePermission("products.archive") }, async (req, reply) => {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return bad(reply, req.id);
    const result = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(products).where(eq(products.id, parsed.data.id)).limit(1);
      if (!old) return { kind: "missing" as const };
      if (!old.isActive) return { kind: "archived" as const };
      const now = new Date();
      const [row] = await tx.update(products).set({ isActive: false, archivedAt: now, archivedBy: req.user!.id, updatedAt: now }).where(and(eq(products.id, old.id), eq(products.isActive, true))).returning();
      if (!row) return { kind: "archived" as const };
      await tx.insert(auditLogs).values({ userId: req.user!.id, action: "product.archived", entityType: "product", entityId: old.id, oldValuesJson: JSON.stringify({ name: old.name, isActive: true }), newValuesJson: JSON.stringify({ name: old.name, isActive: false, archivedAt: now.toISOString() }) });
      return { kind: "ok" as const, row };
    });
    if (result.kind === "missing") return absent(reply, req.id, "Produit introuvable.");
    if (result.kind === "archived") return clash(reply, req.id, "Ce produit est déjà archivé.");
    return safe(req, { ...result.row, categoryName: null });
  });

  app.post("/api/products/:id/restore", { preHandler: requirePermission("products.restore") }, async (req, reply) => {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return bad(reply, req.id);
    try {
      const result = await db.transaction(async (tx) => {
        const [old] = await tx.select().from(products).where(eq(products.id, parsed.data.id)).limit(1);
        if (!old) return { kind: "missing" as const };
        if (old.isActive) return { kind: "active" as const };
        const conflicts = await tx.select({ id: products.id }).from(products).where(and(eq(products.isActive, true), raw`${products.id} <> ${old.id}`, or(old.sku ? eq(products.sku, old.sku) : undefined, old.manufacturerBarcode ? eq(products.manufacturerBarcode, old.manufacturerBarcode) : undefined, eq(products.internalBarcode, old.internalBarcode)))).limit(1);
        if (conflicts.length) return { kind: "conflict" as const };
        const [row] = await tx.update(products).set({ isActive: true, archivedAt: null, archivedBy: null, updatedAt: new Date() }).where(and(eq(products.id, old.id), eq(products.isActive, false))).returning();
        if (!row) return { kind: "active" as const };
        await tx.insert(auditLogs).values({ userId: req.user!.id, action: "product.restored", entityType: "product", entityId: old.id, oldValuesJson: JSON.stringify({ name: old.name, isActive: false }), newValuesJson: JSON.stringify({ name: old.name, isActive: true }) });
        return { kind: "ok" as const, row };
      });
      if (result.kind === "missing") return absent(reply, req.id, "Produit introuvable.");
      if (result.kind === "active") return clash(reply, req.id, "Ce produit est déjà actif.");
      if (result.kind === "conflict") return clash(reply, req.id, "Le code-barres ou le SKU est déjà utilisé par un produit actif.");
      return safe(req, { ...result.row, categoryName: null });
    } catch (error) {
      if (unique(error)) return clash(reply, req.id, "Le code-barres ou le SKU est déjà utilisé par un produit actif.");
      throw error;
    }
  });

  app.delete("/api/products/:id", { preHandler: requirePermission("products.delete_permanently") }, async (req, reply) => {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return bad(reply, req.id);
    try {
      const result = await db.transaction(async (tx) => {
        const [product] = await tx.select().from(products).where(eq(products.id, parsed.data.id)).limit(1);
        if (!product) return { kind: "missing" as const };
        if (product.currentStock !== 0) return { kind: "stock" as const };
        const checks = await Promise.all([
          tx.select({ id: saleItems.id }).from(saleItems).where(eq(saleItems.productId, product.id)).limit(1),
          tx.select({ id: purchaseItems.id }).from(purchaseItems).where(eq(purchaseItems.productId, product.id)).limit(1),
          tx.select({ id: returnItems.id }).from(returnItems).where(eq(returnItems.productId, product.id)).limit(1),
          tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.productId, product.id)).limit(1),
          tx.select({ id: productPriceHistory.id }).from(productPriceHistory).where(eq(productPriceHistory.productId, product.id)).limit(1),
          tx.select({ id: productUnits.id }).from(productUnits).where(eq(productUnits.productId, product.id)).limit(1),
          tx.select({ id: serializedReceivingSessions.id }).from(serializedReceivingSessions).where(eq(serializedReceivingSessions.productId, product.id)).limit(1),
        ]);
        if (checks.some((rows) => rows.length > 0)) return { kind: "history" as const };
        await tx.insert(auditLogs).values({ userId: req.user!.id, action: "product.permanently_deleted", entityType: "product", entityId: product.id, oldValuesJson: JSON.stringify({ id: product.id, name: product.name, sku: product.sku, manufacturerBarcode: product.manufacturerBarcode, internalBarcode: product.internalBarcode, isActive: product.isActive, currentStock: product.currentStock }), newValuesJson: JSON.stringify({ eligible: true }) });
        const deleted = await tx.delete(products).where(and(eq(products.id, product.id), eq(products.currentStock, 0))).returning({ id: products.id });
        return deleted.length ? { kind: "ok" as const } : { kind: "history" as const };
      });
      if (result.kind === "missing") return absent(reply, req.id, "Produit introuvable.");
      if (result.kind === "stock") return clash(reply, req.id, "Le stock du produit doit être égal à zéro avant sa suppression définitive.");
      if (result.kind === "history") return clash(reply, req.id, "Ce produit possède un historique et ne peut pas être supprimé. Archivez-le à la place.");
      return reply.code(204).send();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23503") return clash(reply, req.id, "Ce produit possède un historique et ne peut pas être supprimé. Archivez-le à la place.");
      throw error;
    }
  });
  for (const active of [true, false]) app.post(
    `/api/products/:id/${active ? "activate" : "deactivate"}`,
    { preHandler: requirePermission("products.deactivate") },
    async (req, reply) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) return bad(reply, req.id);
      const now = new Date();
      const [row] = await db.update(products).set({ isActive: active, archivedAt: active ? null : now, archivedBy: active ? null : req.user!.id, updatedAt: now }).where(eq(products.id, parsed.data.id)).returning();
      return row ?? absent(reply, req.id, "Produit introuvable.");
    },
  );
  app.get(
    "/api/stock",
    { preHandler: requirePermission("stock.view") },
    async (req, reply) => {
      const p = stockFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, req.id);
      const q = p.data,
        w = and(
          eq(products.productType, "physical_product"),
          q.search
            ? or(
                ilike(products.name, `%${q.search}%`),
                ilike(products.sku, `%${q.search}%`),
                ilike(products.internalBarcode, `%${q.search}%`),
              )
            : undefined,
          q.categoryId ? eq(products.categoryId, q.categoryId) : undefined,
          q.status === "active"
            ? eq(products.isActive, true)
            : q.status === "inactive"
              ? eq(products.isActive, false)
              : undefined,
          q.lowStockOnly
            ? and(
                eq(products.trackStock, true),
                lte(products.currentStock, products.minimumStock),
              )
            : undefined,
          q.outOfStockOnly
            ? and(eq(products.trackStock, true), eq(products.currentStock, 0))
            : undefined,
        ),
        rows = await db
          .select(pf)
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(w)
          .orderBy(asc(products.name))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        [total] = await db
          .select({ n: raw<number>`count(*)::int` })
          .from(products)
          .where(w);
      return {
        ...paging(q.page, q.pageSize, total?.n ?? 0),
        rows: rows.map((x) => {
          const value = safe(req, x);
          return canCost(req)
            ? {
                ...value,
                stockValueCents: x.purchasePriceCents * x.currentStock,
              }
            : value;
        }),
      };
    },
  );
  app.get(
    "/api/stock/movements",
    { preHandler: requirePermission("stock.view") },
    async (req, reply) => {
      const p = stockMovementFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, req.id);
      const q = p.data,
        w = and(
          q.productId ? eq(stockMovements.productId, q.productId) : undefined,
          q.movementType
            ? eq(stockMovements.movementType, q.movementType)
            : undefined,
          q.workerId ? eq(stockMovements.createdBy, q.workerId) : undefined,
          q.startDate
            ? gte(
                stockMovements.createdAt,
                new Date(`${q.startDate}T00:00:00Z`),
              )
            : undefined,
          q.endDate
            ? lte(
                stockMovements.createdAt,
                new Date(`${q.endDate}T23:59:59.999Z`),
              )
            : undefined,
        ),
        rows = await db
          .select({
            id: stockMovements.id,
            productId: stockMovements.productId,
            productName: products.name,
            movementType: stockMovements.movementType,
            quantityChange: stockMovements.quantityChange,
            stockBefore: stockMovements.stockBefore,
            stockAfter: stockMovements.stockAfter,
            workerId: stockMovements.createdBy,
            workerName: users.fullName,
            reason: stockMovements.reason,
            referenceType: stockMovements.referenceType,
            referenceId: stockMovements.referenceId,
            createdAt: stockMovements.createdAt,
          })
          .from(stockMovements)
          .innerJoin(products, eq(stockMovements.productId, products.id))
          .innerJoin(users, eq(stockMovements.createdBy, users.id))
          .where(w)
          .orderBy(desc(stockMovements.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        [total] = await db
          .select({ n: raw<number>`count(*)::int` })
          .from(stockMovements)
          .where(w);
      return { ...paging(q.page, q.pageSize, total?.n ?? 0), rows };
    },
  );
  app.post(
    "/api/stock/adjustments",
    { preHandler: requirePermission("stock.adjust") },
    async (req, reply) => {
      const p = stockAdjustmentSchema.safeParse(req.body);
      if (!p.success) return bad(reply, req.id, p.error.flatten().fieldErrors);
      try {
        const result = await db.transaction(async (tx) => {
          await tx.execute(
            raw`select id from products where id=${p.data.productId} for update`,
          );
          const [product] = await tx
            .select()
            .from(products)
            .where(eq(products.id, p.data.productId))
            .limit(1);
          if (!product) throw Object.assign(new Error(), { kind: "missing" });
          if (!product.isActive) throw Object.assign(new Error(), { kind: "inactive" });
          if (product.productType !== "physical_product" || !product.trackStock)
            throw Object.assign(new Error(), { kind: "tracking" });
          if (product.inventoryMode === "serialized")
            throw Object.assign(new Error(), { kind: "serialized" });
          const increase = [
              "manual_adjustment",
              "inventory_adjustment",
            ].includes(p.data.movementType)
              ? p.data.direction === "increase"
              : ["opening_stock", "stock_in"].includes(p.data.movementType),
            change = increase ? p.data.quantity : -p.data.quantity,
            after = product.currentStock + change;
          if (after < 0) throw Object.assign(new Error(), { kind: "negative" });
          const [movement] = await tx
            .insert(stockMovements)
            .values({
              productId: product.id,
              movementType: p.data.movementType,
              quantityChange: change,
              stockBefore: product.currentStock,
              stockAfter: after,
              reason: p.data.reason,
              idempotencyKey: p.data.idempotencyKey,
              createdBy: req.user!.id,
            })
            .returning();
          await tx
            .update(products)
            .set({ currentStock: after, updatedAt: new Date() })
            .where(eq(products.id, product.id));
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "stock.adjusted",
            entityType: "product",
            entityId: product.id,
            oldValuesJson: JSON.stringify({ stock: product.currentStock }),
            newValuesJson: JSON.stringify({
              stock: after,
              movementId: movement!.id,
            }),
          });
          return movement!;
        });
        return reply.code(201).send(result);
      } catch (e) {
        if (unique(e))
          return clash(reply, req.id, "Cet ajustement a déjà été enregistré.");
        const k = (e as { kind?: string }).kind;
        if (k === "missing")
          return absent(reply, req.id, "Produit introuvable.");
        if (k === "inactive")
          return clash(reply, req.id, "Ce produit est archivé et ne peut pas être ajusté.");
        if (k === "tracking")
          return clash(
            reply,
            req.id,
            "Le stock ne peut pas être ajusté pour ce produit ou service.",
          );
        if (k === "serialized")
          return clash(reply, req.id, "Utilisez la réception par unités pour ce produit sérialisé.");
        if (k === "negative")
          return clash(
            reply,
            req.id,
            "Stock insuffisant : le stock ne peut pas devenir négatif.",
          );
        throw e;
      }
    },
  );
  app.post(
    "/api/stock/receipts",
    { preHandler: requirePermission("stock.adjust") },
    async (req, reply) => {
      const parsed = quickStockReceiptSchema.safeParse(req.body);
      if (!parsed.success)
        return bad(reply, req.id, parsed.error.flatten().fieldErrors);
      try {
        const result = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: stockMovements.id, stockAfter: stockMovements.stockAfter, quantityChange: stockMovements.quantityChange })
            .from(stockMovements)
            .where(eq(stockMovements.idempotencyKey, parsed.data.idempotencyKey))
            .limit(1);
          if (existing)
            return { productId: parsed.data.productId, newStock: existing.stockAfter, quantityAdded: existing.quantityChange, duplicate: true };
          await tx.execute(raw`select id from products where id=${parsed.data.productId} for update`);
          const [product] = await tx.select().from(products).where(eq(products.id, parsed.data.productId)).limit(1);
          if (!product) throw Object.assign(new Error(), { kind: "missing" });
          if (!product.isActive) throw Object.assign(new Error(), { kind: "inactive" });
          if (product.productType !== "physical_product" || !product.trackStock)
            throw Object.assign(new Error(), { kind: "tracking" });
          if (product.inventoryMode !== "quantity")
            throw Object.assign(new Error(), { kind: "serialized" });
          const after = product.currentStock + parsed.data.quantity;
          const [movement] = await tx.insert(stockMovements).values({
            productId: product.id,
            movementType: "stock_in",
            quantityChange: parsed.data.quantity,
            stockBefore: product.currentStock,
            stockAfter: after,
            reason: "Réception rapide par scanner",
            idempotencyKey: parsed.data.idempotencyKey,
            createdBy: req.user!.id,
          }).returning({ id: stockMovements.id });
          await tx.update(products).set({ currentStock: after, updatedAt: new Date() }).where(eq(products.id, product.id));
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "stock.received",
            entityType: "product",
            entityId: product.id,
            oldValuesJson: JSON.stringify({ stock: product.currentStock }),
            newValuesJson: JSON.stringify({ stock: after, quantityAdded: parsed.data.quantity, movementId: movement!.id }),
          });
          return { productId: product.id, newStock: after, quantityAdded: parsed.data.quantity, duplicate: false };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        const kind = (error as { kind?: string }).kind;
        if (kind === "missing") return absent(reply, req.id, "Produit introuvable.");
        if (kind === "inactive") return clash(reply, req.id, "Ce produit est inactif.");
        if (kind === "tracking") return clash(reply, req.id, "Ce produit ne gère pas de stock.");
        if (kind === "serialized") return clash(reply, req.id, "Utilisez la réception par unité pour ce produit avancé.");
        if (unique(error)) return clash(reply, req.id, "Cette réception a déjà été enregistrée.");
        throw error;
      }
    },
  );
}
