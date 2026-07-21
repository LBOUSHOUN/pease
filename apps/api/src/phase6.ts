import type { FastifyInstance, FastifyReply } from "fastify";
import {
  idParamSchema,
  serializedReceivingCreateSchema,
  serializedReceivingBatchSchema,
  serializedReceivingQuantitySchema,
  serializedReceivingScanSchema,
} from "@maktaba/validation";
import { requirePermission } from "./auth.js";
import { sql } from "./db/index.js";

type Row = Record<string, unknown>;
const fail = (reply: FastifyReply, status: number, message: string) =>
  reply.code(status).send({
    code: status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : status === 409 ? "CONFLICT" : "VALIDATION_ERROR",
    message,
  });
const csvCell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const sessionResult = async (id: number) => {
  const [session] = await sql<Row[]>`
    select s.*,p.name product_name,p.inventory_mode,p.is_active,
      count(x.id)::int scanned_quantity
    from serialized_receiving_sessions s
    join products p on p.id=s.product_id
    left join serialized_receiving_scans x on x.session_id=s.id
    where s.id=${id}
    group by s.id,p.name,p.inventory_mode,p.is_active`;
  if (!session) return null;
  const scans = await sql<Row[]>`
    select id,barcode,created_at from serialized_receiving_scans
    where session_id=${id} order by created_at desc,id desc`;
  const expected = Number(session.expected_quantity), scanned = Number(session.scanned_quantity);
  return {
    id: Number(session.id),
    productId: Number(session.product_id),
    productName: session.product_name,
    supplierId: session.supplier_id ? Number(session.supplier_id) : null,
    purchaseId: session.purchase_id ? Number(session.purchase_id) : null,
    expectedQuantity: expected,
    scannedQuantity: scanned,
    remainingQuantity: Math.max(0, expected - scanned),
    status: session.status,
    createdAt: session.created_at,
    completedAt: session.completed_at,
    scans: scans.map((scan) => ({ id: Number(scan.id), barcode: scan.barcode, createdAt: scan.created_at })),
  };
};

export async function registerPhase6(app: FastifyInstance) {
  app.get("/api/serialized-units/export.csv", { preHandler: requirePermission("serialized_units.export") }, async (req, reply) => {
    const rows = await sql<Row[]>`
      select p.name product,u.barcode unit_barcode,u.status,
             coalesce(pu.purchase_number,'') purchase_reference,
             coalesce(s.sale_number,'') sale_reference,
             u.received_at,u.sold_at,u.returned_at
      from product_units u join products p on p.id=u.product_id
      left join purchases pu on pu.id=u.purchase_id
      left join sales s on s.id=u.sale_id
      order by p.name,u.barcode`;
    const headers = ["Produit", "Code unitaire", "Statut", "Achat", "Vente", "Reçue le", "Vendue le", "Retournée le"];
    const keys = ["product", "unit_barcode", "status", "purchase_reference", "sale_reference", "received_at", "sold_at", "returned_at"];
    const body = `\ufeff${headers.map(csvCell).join(";")}\r\n${rows.map((row) => keys.map((key) => csvCell(row[key])).join(";")).join("\r\n")}${rows.length ? "\r\n" : ""}`;
    await sql`insert into audit_logs(user_id,action,entity_type,new_values_json)
      values(${req.user!.id},'serialized_units.exported','product_unit',${JSON.stringify({ count: rows.length })})`;
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="unites-serialisees.csv"')
      .send(body);
  });
  app.get("/api/product-units/cache", { preHandler: requirePermission("products.view") }, async (req) => {
    const query = req.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 500));
    const offset = (page - 1) * pageSize;
    const rows = await sql<Row[]>`
      select u.id,u.product_id,u.barcode,u.status,u.updated_at,
             p.name product_name,p.selling_price_cents,p.is_active product_active
      from product_units u join products p on p.id=u.product_id
      where p.inventory_mode='serialized' and p.is_active=true
      order by u.id limit ${pageSize} offset ${offset}`;
    const [count] = await sql<Row[]>`
      select count(*)::int total from product_units u join products p on p.id=u.product_id
      where p.inventory_mode='serialized' and p.is_active=true`;
    return {
      rows: rows.map((unit) => ({
        id: Number(unit.id), productId: Number(unit.product_id), barcode: unit.barcode,
        status: unit.status, productName: unit.product_name,
        sellingPriceCents: Number(unit.selling_price_cents),
        productActive: Boolean(unit.product_active), updatedAt: unit.updated_at,
      })),
      total: Number(count?.total ?? 0), page, pageSize,
    };
  });
  app.post("/api/serialized-receiving", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const parsed = serializedReceivingCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "La quantité prévue doit être un entier positif inférieur ou égal à 1000.");
    const input = parsed.data;
    const [product] = await sql<Row[]>`select id,inventory_mode,is_active from products where id=${input.productId}`;
    if (!product) return fail(reply, 404, "Produit introuvable.");
    if (!product.is_active) return fail(reply, 409, "Ce produit est inactif.");
    if (product.inventory_mode !== "serialized") return fail(reply, 409, "Ce produit n’utilise pas le suivi par unité.");
    if (input.supplierId) {
      const [supplier] = await sql<Row[]>`select id from suppliers where id=${input.supplierId} and is_active=true`;
      if (!supplier) return fail(reply, 404, "Fournisseur actif introuvable.");
    }
    const [created] = await sql<Row[]>`
      insert into serialized_receiving_sessions(product_id,supplier_id,expected_quantity,created_by)
      values(${input.productId},${input.supplierId ?? null},${input.expectedQuantity},${req.user!.id}) returning id`;
    const createdId = Number(created!.id);
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json)
      values(${req.user!.id},'serialized_receiving.created','serialized_receiving',${createdId},${JSON.stringify({ productId: input.productId, expectedQuantity: input.expectedQuantity })})`;
    return reply.code(201).send(await sessionResult(createdId));
  });

  app.get("/api/serialized-receiving/:id", { preHandler: requirePermission("serialized_units.view") }, async (req, reply) => {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return fail(reply, 400, "Réception invalide.");
    const result = await sessionResult(parsed.data.id);
    return result ?? fail(reply, 404, "Réception introuvable.");
  });

  app.patch("/api/serialized-receiving/:id/expected-quantity", { preHandler: requirePermission("serialized_units.adjust") }, async (req, reply) => {
    const id = idParamSchema.safeParse(req.params), body = serializedReceivingQuantitySchema.safeParse(req.body);
    if (!id.success || !body.success) return fail(reply, 400, "La quantité prévue doit être un entier positif inférieur ou égal à 1000.");
    const current = await sessionResult(id.data.id);
    if (!current) return fail(reply, 404, "Réception introuvable.");
    if (current.status !== "draft") return fail(reply, 409, "Cette réception ne peut plus être modifiée.");
    if (body.data.expectedQuantity < current.scannedQuantity)
      return fail(reply, 409, "La quantité prévue ne peut pas être inférieure au nombre d’unités déjà scannées.");
    await sql`update serialized_receiving_sessions set expected_quantity=${body.data.expectedQuantity},updated_at=now() where id=${id.data.id}`;
    return sessionResult(id.data.id);
  });

  app.post("/api/serialized-receiving/:id/scans", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const id = idParamSchema.safeParse(req.params), body = serializedReceivingScanSchema.safeParse(req.body);
    if (!id.success || !body.success) return fail(reply, 400, "Code-barres invalide.");
    const barcode = body.data.barcode;
    try {
      await sql.begin(async (tx) => {
        const [session] = await tx<Row[]>`select * from serialized_receiving_sessions where id=${id.data.id} for update`;
        if (!session) throw new Error("MISSING");
        if (session.status !== "draft") throw new Error("CLOSED");
        const counts = await tx<Row[]>`select count(*)::int count from serialized_receiving_scans where session_id=${id.data.id}`;
        const count = counts[0]?.count ?? 0;
        if (Number(count) >= Number(session.expected_quantity)) throw new Error("FULL");
        const [existing] = await tx<Row[]>`select id from product_units where lower(trim(barcode))=lower(trim(${barcode}))`;
        if (existing) throw new Error("EXISTS");
        const [otherDraft] = await tx<Row[]>`select id from serialized_receiving_scans where lower(trim(barcode))=lower(trim(${barcode})) limit 1`;
        if (otherDraft) throw new Error("DUPLICATE");
        await tx`insert into serialized_receiving_scans(session_id,barcode) values(${id.data.id},${barcode})`;
      });
      return reply.code(201).send(await sessionResult(id.data.id));
    } catch (error) {
      const message = (error as Error).message;
      if (message === "MISSING") return fail(reply, 404, "Réception introuvable.");
      if (message === "FULL") return fail(reply, 409, "Quantité prévue atteinte.");
      if (message === "EXISTS") return fail(reply, 409, "Cette unité existe déjà dans le stock.");
      if (message === "DUPLICATE" || (error as { code?: string }).code === "23505") return fail(reply, 409, "Code-barres déjà scanné.");
      if (message === "CLOSED") return fail(reply, 409, "Cette réception est terminée.");
      throw error;
    }
  });

  app.post("/api/serialized-receiving/:id/scans/batch", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const id = idParamSchema.safeParse(req.params);
    const body = serializedReceivingBatchSchema.safeParse(req.body);
    if (!id.success || !body.success)
      return fail(reply, 400, "Le lot contient un ou plusieurs codes-barres invalides.");
    const normalized = body.data.barcodes.map((barcode) => barcode.trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length)
      return fail(reply, 409, "Le lot contient des codes-barres en double.");
    try {
      await sql.begin(async (tx) => {
        const [session] = await tx<Row[]>`select * from serialized_receiving_sessions where id=${id.data.id} for update`;
        if (!session) throw new Error("MISSING");
        if (session.status !== "draft") throw new Error("CLOSED");
        const [count] = await tx<Row[]>`select count(*)::int value from serialized_receiving_scans where session_id=${id.data.id}`;
        if (Number(count!.value) + normalized.length > Number(session.expected_quantity))
          throw new Error("FULL");
        const staged = await tx<Row[]>`select barcode from serialized_receiving_scans where lower(trim(barcode)) in ${sql(normalized)}`;
        if (staged.length) throw new Error("DUPLICATE");
        const existing = await tx<Row[]>`select barcode from product_units where lower(trim(barcode)) in ${sql(normalized)}`;
        if (existing.length) throw new Error("EXISTS");
        for (const barcode of body.data.barcodes)
          await tx`insert into serialized_receiving_scans(session_id,barcode) values(${id.data.id},${barcode})`;
      });
      return reply.code(201).send(await sessionResult(id.data.id));
    } catch (error) {
      const message = (error as Error).message;
      if (message === "MISSING") return fail(reply, 404, "Réception introuvable.");
      if (message === "CLOSED") return fail(reply, 409, "Cette réception est terminée.");
      if (message === "FULL") return fail(reply, 409, "Le lot dépasse la quantité prévue restante.");
      if (message === "DUPLICATE") return fail(reply, 409, "Un code-barres du lot est déjà scanné.");
      if (message === "EXISTS") return fail(reply, 409, "Une unité du lot existe déjà dans le stock.");
      throw error;
    }
  });

  app.delete("/api/serialized-receiving/:id/scans/:scanId", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const params = req.params as { id: string; scanId: string };
    const id = Number(params.id), scanId = Number(params.scanId);
    if (!Number.isInteger(id) || !Number.isInteger(scanId)) return fail(reply, 400, "Scan invalide.");
    const rows = await sql<Row[]>`delete from serialized_receiving_scans x using serialized_receiving_sessions s
      where x.id=${scanId} and x.session_id=${id} and s.id=x.session_id and s.status='draft' returning x.id`;
    if (!rows[0]) return fail(reply, 404, "Scan introuvable.");
    return reply.code(204).send();
  });

  app.post("/api/serialized-receiving/:id/cancel", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return fail(reply, 400, "Réception invalide.");
    const rows = await sql<Row[]>`update serialized_receiving_sessions set status='cancelled',updated_at=now()
      where id=${parsed.data.id} and status='draft' returning id`;
    if (!rows[0]) return fail(reply, 409, "Cette réception ne peut plus être annulée.");
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id)
      values(${req.user!.id},'serialized_receiving.cancelled','serialized_receiving',${parsed.data.id})`;
    return sessionResult(parsed.data.id);
  });

  app.post("/api/serialized-receiving/:id/confirm", { preHandler: requirePermission("serialized_units.receive") }, async (req, reply) => {
    const id = idParamSchema.safeParse(req.params);
    if (!id.success) return fail(reply, 400, "Réception invalide.");
    try {
      const completed = await sql.begin(async (tx) => {
        const [session] = await tx<Row[]>`select s.*,p.name,p.current_stock,p.purchase_price_cents,p.inventory_mode,p.is_active
          from serialized_receiving_sessions s join products p on p.id=s.product_id where s.id=${id.data.id} for update of s,p`;
        if (!session) throw new Error("MISSING");
        if (session.status !== "draft") throw new Error("CLOSED");
        if (session.inventory_mode !== "serialized") throw new Error("MODE");
        if (!session.is_active) throw new Error("INACTIVE");
        const sessionId = Number(session.id), productId = Number(session.product_id),
          supplierId = session.supplier_id ? Number(session.supplier_id) : null,
          purchasePrice = Number(session.purchase_price_cents);
        const scans = await tx<Row[]>`select barcode from serialized_receiving_scans where session_id=${id.data.id} order by id`;
        const remaining = Number(session.expected_quantity) - scans.length;
        if (remaining !== 0) throw new Error(`INCOMPLETE:${remaining}`);
        const normalizedBarcodes = scans.map((x) => String(x.barcode).trim().toLowerCase());
        const conflicts = await tx<Row[]>`select barcode from product_units where lower(trim(barcode)) = any(${normalizedBarcodes})`;
        if (conflicts.length) throw new Error("EXISTS");
        let purchaseId: number | null = null, purchaseItemId: number | null = null;
        if (supplierId) {
          const [setting] = await tx<Row[]>`select next_purchase_sequence from app_settings where id=1 for update`;
          const sequence = Number(setting?.next_purchase_sequence ?? 1), number = `PUR-${new Date().getUTCFullYear()}-${String(sequence).padStart(6,"0")}`;
          const total = scans.length * purchasePrice;
          await tx`update app_settings set next_purchase_sequence=next_purchase_sequence+1,updated_at=now() where id=1`;
          const [purchase] = await tx<Row[]>`insert into purchases(purchase_number,supplier_id,subtotal_cents,total_cents,paid_cents,remaining_cents,payment_mode,payment_source,reference,notes,created_by)
            values(${number},${supplierId},${total},${total},0,${total},'credit','external_cash',${`Réception sérialisée #${sessionId}`},'Unités sérialisées',${req.user!.id}) returning id`;
          purchaseId = Number(purchase!.id);
          const [item] = await tx<Row[]>`insert into purchase_items(purchase_id,product_id,quantity,unit_purchase_price_cents,line_total_cents)
            values(${purchaseId},${productId},${scans.length},${purchasePrice},${total}) returning id`;
          purchaseItemId = Number(item!.id);
          await tx`update suppliers set current_debt_cents=current_debt_cents+${total},updated_at=now() where id=${supplierId}`;
        }
        for (const scan of scans) await tx`insert into product_units(product_id,barcode,receiving_session_id,purchase_id,purchase_item_id)
          values(${productId},${String(scan.barcode).trim()},${sessionId},${purchaseId},${purchaseItemId})`;
        const [product] = await tx<Row[]>`select current_stock from products where id=${productId}`;
        const after = Number(product!.current_stock), before = after - scans.length;
        await tx`insert into stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by)
          values(${productId},'stock_in',${scans.length},${before},${after},'serialized_receiving',${sessionId},'Réception d’unités sérialisées',${req.user!.id})`;
        await tx`update serialized_receiving_sessions set status='completed',purchase_id=${purchaseId},completed_at=now(),updated_at=now() where id=${id.data.id}`;
        await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json)
          values(${req.user!.id},'serialized_receiving.completed','serialized_receiving',${sessionId},${JSON.stringify({ productId, quantity: scans.length, purchaseId })})`;
        return { quantity: scans.length, purchaseId, stock: after };
      });
      return reply.code(201).send({ ...(await sessionResult(id.data.id)), ...completed });
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith("INCOMPLETE:")) return fail(reply, 409, `Réception incomplète : ${message.split(":")[1]} unité(s) restante(s).`);
      if (message === "EXISTS" || (error as { code?: string }).code === "23505") return fail(reply, 409, "Cette unité existe déjà dans le stock.");
      if (message === "MODE") return fail(reply, 409, "Ce produit n’utilise pas le suivi par unité.");
      if (message === "INACTIVE") return fail(reply, 409, "Ce produit est inactif.");
      if (message === "MISSING") return fail(reply, 404, "Réception introuvable.");
      if (message === "CLOSED") return fail(reply, 409, "Cette réception est déjà terminée.");
      throw error;
    }
  });

  app.get("/api/product-units/lookup/:barcode", { preHandler: requirePermission("products.view") }, async (req, reply) => {
    const parsed = serializedReceivingScanSchema.safeParse({ barcode: (req.params as { barcode: string }).barcode });
    if (!parsed.success) return fail(reply, 400, "Code-barres invalide.");
    const [unit] = await sql<Row[]>`select u.*,p.name product_name,p.category_id,p.product_type,p.sku,p.manufacturer_barcode,
      p.internal_barcode,p.qr_identifier,p.selling_price_cents,p.current_stock,p.minimum_stock,p.unit,p.shelf_location,
      p.is_active product_active,p.track_stock,p.inventory_mode
      from product_units u join products p on p.id=u.product_id where lower(trim(u.barcode))=lower(trim(${parsed.data.barcode}))`;
    if (!unit) return fail(reply, 404, "Unité introuvable.");
    const stock = Number(unit.current_stock);
    return {
      unit: { id: Number(unit.id), barcode: unit.barcode, status: unit.status },
      product: {
        id: Number(unit.product_id), categoryId: unit.category_id ? Number(unit.category_id) : null,
        categoryName: null, name: unit.product_name, productType: unit.product_type,
        inventoryMode: "serialized", sku: unit.sku, manufacturerBarcode: unit.manufacturer_barcode,
        internalBarcode: unit.internal_barcode, qrIdentifier: unit.qr_identifier,
        sellingPriceCents: Number(unit.selling_price_cents), currentStock: stock,
        minimumStock: Number(unit.minimum_stock), unit: unit.unit, shelfLocation: unit.shelf_location,
        isActive: unit.product_active, trackStock: unit.track_stock,
        isLowStock: Boolean(unit.track_stock) && stock <= Number(unit.minimum_stock),
        isOutOfStock: Boolean(unit.track_stock) && stock === 0,
      },
    };
  });
}
