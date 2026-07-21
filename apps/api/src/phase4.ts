/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  expenseCorrectionSchema,
  expenseCreateSchema,
  expenseFiltersSchema,
  idParamSchema,
  paginationSchema,
  purchaseCreateSchema,
  purchaseFiltersSchema,
  returnCreateSchema,
  returnFiltersSchema,
  supplierCreateSchema,
  supplierFiltersSchema,
  supplierPaymentSchema,
  supplierUpdateSchema,
} from "@maktaba/validation";
import { requirePermission } from "./auth.js";
import { sql } from "./db/index.js";
type Row = Record<string, any>;
const bad = (reply: FastifyReply, message: string, status = 400) =>
  reply.code(status).send({
    code:
      status === 409
        ? "CONFLICT"
        : status === 404
          ? "NOT_FOUND"
          : "VALIDATION_ERROR",
    message,
  });
const pages = (total: number, page: number, pageSize: number) => ({
  page,
  pageSize,
  totalRows: total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});
const phone = (v: string | null | undefined) =>
  v?.replace(/[\s().-]/g, "") || null;
const supplierRow = (r: Row) => ({
  id: Number(r.id),
  name: r.name,
  phone: r.phone,
  email: r.email,
  address: r.address,
  notes: r.notes,
  currentDebtCents: Number(r.current_debt_cents),
  isActive: Boolean(r.is_active),
  createdBy: r.created_by ? Number(r.created_by) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const ledgerRow = (r: Row) => ({
  id: Number(r.id),
  supplierId: Number(r.supplier_id),
  purchaseId: r.purchase_id ? Number(r.purchase_id) : null,
  registerSessionId: r.cash_register_session_id
    ? Number(r.cash_register_session_id)
    : null,
  transactionType: r.transaction_type,
  paymentSource: r.payment_source,
  amountCents: Number(r.amount_cents),
  balanceBeforeCents: Number(r.balance_before_cents),
  balanceAfterCents: Number(r.balance_after_cents),
  notes: r.notes,
  workerName: r.worker_name,
  createdAt: r.created_at,
});
const purchaseRow = (r: Row) => ({
  id: Number(r.id),
  purchaseNumber: r.purchase_number,
  supplierId: Number(r.supplier_id),
  supplierName: r.supplier_name,
  workerName: r.worker_name,
  totalCents: Number(r.total_cents),
  cashPaidCents: Number(r.paid_cents),
  creditAmountCents: Number(r.remaining_cents),
  paymentMode: r.payment_mode,
  paymentSource: r.payment_source,
  invoiceNumber: r.invoice_number,
  invoiceDate: r.invoice_date,
  itemCount: Number(r.item_count ?? 0),
  createdAt: r.created_at,
});
const expenseRow = (r: Row) => ({
  id: Number(r.id),
  category: r.category,
  description: r.description,
  amountCents: Number(r.amount_cents),
  paymentSource: r.payment_source,
  registerSessionId: r.cash_register_session_id
    ? Number(r.cash_register_session_id)
    : null,
  expenseDate: r.expense_date,
  status: r.status,
  correctionOfExpenseId: r.correction_of_id ? Number(r.correction_of_id) : null,
  correctionReason: r.correction_reason,
  notes: r.notes,
  workerName: r.worker_name,
  createdAt: r.created_at,
});
const returnRow = (r: Row) => ({
  id: Number(r.id),
  returnNumber: r.return_number,
  saleId: Number(r.original_sale_id),
  saleNumber: r.sale_number,
  customerName: r.customer_name,
  workerName: r.worker_name,
  totalCents: Number(r.total_return_value_cents),
  debtReductionCents: Number(r.customer_debt_reduction_cents),
  cashRefundCents: Number(r.cash_refund_cents),
  status: r.status,
  createdAt: r.created_at,
});

export async function registerPhase4(app: FastifyInstance) {
  app.get(
    "/api/suppliers",
    { preHandler: requirePermission("suppliers.view") },
    async (req, reply) => {
      const p = supplierFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        o = (x.page - 1) * x.pageSize,
        q = `%${x.search}%`;
      const rows = await sql<
        Row[]
      >`select s.*,count(*) over() total_count from suppliers s where (${x.search}='' or s.name ilike ${q} or coalesce(s.phone,'') ilike ${q} or coalesce(s.email,'') ilike ${q}) and (${x.status}='all' or s.is_active=${x.status === "active"}) and (${!x.debtOnly} or s.current_debt_cents>0) order by lower(s.name),s.id limit ${x.pageSize} offset ${o}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(supplierRow),
      };
    },
  );
  app.post(
    "/api/suppliers",
    { preHandler: requirePermission("suppliers.manage") },
    async (req, reply) => {
      const p = supplierCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Données fournisseur invalides.");
      const x = p.data,
        [r] = await sql<
          Row[]
        >`insert into suppliers(name,phone,email,address,notes,created_by) values(${x.name},${phone(x.phone)},${x.email ?? null},${x.address ?? null},${x.notes ?? null},${req.user!.id}) returning *`;
      await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'supplier.created','supplier',${r!.id})`;
      return reply.code(201).send(supplierRow(r!));
    },
  );
  app.get(
    "/api/suppliers/:id",
    { preHandler: requirePermission("suppliers.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [r] = await sql<
        Row[]
      >`select * from suppliers where id=${p.data.id}`;
      return r ? supplierRow(r) : bad(reply, "Fournisseur introuvable.", 404);
    },
  );
  app.patch(
    "/api/suppliers/:id",
    { preHandler: requirePermission("suppliers.manage") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = supplierUpdateSchema.safeParse(req.body);
      if (!id.success || !p.success) return bad(reply, "Données invalides.");
      const [r] = await sql<
        Row[]
      >`select * from suppliers where id=${id.data.id}`;
      if (!r) return bad(reply, "Fournisseur introuvable.", 404);
      const x = p.data,
        [u] = await sql<
          Row[]
        >`update suppliers set name=${x.name ?? r.name},phone=${x.phone === undefined ? r.phone : phone(x.phone)},email=${x.email === undefined ? r.email : x.email},address=${x.address === undefined ? r.address : x.address},notes=${x.notes === undefined ? r.notes : x.notes},updated_at=now() where id=${id.data.id} returning *`;
      await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'supplier.updated','supplier',${id.data.id})`;
      return supplierRow(u!);
    },
  );
  for (const action of ["activate", "deactivate"] as const)
    app.post(
      `/api/suppliers/:id/${action}`,
      { preHandler: requirePermission("suppliers.manage") },
      async (req, reply) => {
        const p = idParamSchema.safeParse(req.params);
        if (!p.success) return bad(reply, "Identifiant invalide.");
        const [r] = await sql<
          Row[]
        >`update suppliers set is_active=${action === "activate"},updated_at=now() where id=${p.data.id} returning *`;
        return r ? supplierRow(r) : bad(reply, "Fournisseur introuvable.", 404);
      },
    );
  app.get(
    "/api/suppliers/:id/ledger",
    { preHandler: requirePermission("supplier_credit.view") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = paginationSchema.safeParse(req.query);
      if (!id.success || !p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        o = (x.page - 1) * x.pageSize,
        rows = await sql<
          Row[]
        >`select l.*,u.full_name worker_name,count(*) over() total_count from supplier_payments l join users u on u.id=l.created_by where l.supplier_id=${id.data.id} order by l.created_at desc limit ${x.pageSize} offset ${o}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(ledgerRow),
      };
    },
  );
  app.post(
    "/api/suppliers/:id/payments",
    { preHandler: requirePermission("supplier_credit.manage") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = supplierPaymentSchema.safeParse(req.body);
      if (!id.success || !p.success) return bad(reply, "Paiement invalide.");
      const x = p.data;
      try {
        const result = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${req.user!.id},41001)`;
          const [prior] = await tx<
            Row[]
          >`select * from supplier_payments where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior)
            return {
              transactionId: Number(prior.id),
              remainingDebtCents: Number(prior.balance_after_cents),
              duplicate: true,
            };
          let reg: Row | undefined;
          if (x.paymentSource === "cash_register") {
            [reg] = await tx<
              Row[]
            >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("REGISTER");
          }
          const [s] = await tx<
            Row[]
          >`select * from suppliers where id=${id.data.id} and is_active=true for update`;
          if (!s) throw new Error("SUPPLIER");
          const before = Number(s.current_debt_cents);
          if (x.amountCents > before) throw new Error("EXCESS");
          const after = before - x.amountCents;
          await tx`update suppliers set current_debt_cents=${after},updated_at=now() where id=${s.id}`;
          const [l] = await tx<
            Row[]
          >`insert into supplier_payments(supplier_id,cash_register_session_id,transaction_type,payment_source,amount_cents,balance_before_cents,balance_after_cents,idempotency_key,notes,created_by) values(${s.id},${reg?.id ?? null},'supplier_payment',${x.paymentSource},${-x.amountCents},${before},${after},${x.idempotencyKey},${x.note ?? null},${req.user!.id}) returning id`;
          if (reg)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg.id},'supplier_payment',${x.amountCents},'supplier_payment',${l!.id},${x.note ?? "Paiement fournisseur"},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'supplier.payment','supplier',${s.id},${JSON.stringify({ before, after, amount: x.amountCents })})`;
          return {
            transactionId: Number(l!.id),
            remainingDebtCents: after,
            duplicate: false,
          };
        });
        return result;
      } catch (e) {
        const m = (e as Error).message;
        if (m === "REGISTER")
          return bad(reply, "Ouvrez une caisse pour ce paiement.", 409);
        if (m === "SUPPLIER")
          return bad(reply, "Fournisseur actif introuvable.", 404);
        if (m === "EXCESS")
          return bad(reply, "Le paiement dépasse la dette.", 409);
        throw e;
      }
    },
  );

  app.post(
    "/api/purchases",
    { preHandler: requirePermission("purchases.create") },
    async (req, reply) => {
      const p = purchaseCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Achat invalide.");
      const x = p.data,
        map = new Map<number, { quantity: number; price: number }>();
      for (const i of x.items) {
        const old = map.get(i.productId);
        if (old && old.price !== i.purchaseUnitPriceCents)
          return bad(reply, "Prix incohérent pour un article dupliqué.");
        map.set(i.productId, {
          quantity: (old?.quantity ?? 0) + i.quantity,
          price: i.purchaseUnitPriceCents,
        });
      }
      try {
        const result = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${req.user!.id},41002)`;
          const [prior] = await tx<
            Row[]
          >`select * from purchases where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior)
            return {
              ...purchaseRow({
                ...prior,
                supplier_name: null,
                worker_name: req.user!.fullName,
                item_count: 0,
              }),
              duplicate: true,
            };
          const [supplier] = await tx<
            Row[]
          >`select * from suppliers where id=${x.supplierId} and is_active=true for update`;
          if (!supplier) throw new Error("SUPPLIER");
          const ids = [...map.keys()].sort((a, b) => a - b),
            products = await tx<
              Row[]
            >`select * from products where id in ${sql(ids)} order by id for update`;
          if (
            products.length !== ids.length ||
            products.some((v) => v.product_type !== "physical_product")
          )
            throw new Error("PRODUCT");
          if (products.some((v) => v.inventory_mode === "serialized"))
            throw new Error("SERIALIZED_PRODUCT");
          let total = 0;
          for (const product of products) {
            const i = map.get(Number(product.id))!;
            total += i.quantity * i.price;
          }
          let cash = 0,
            credit = 0;
          if (x.paymentMode === "cash") {
            cash = total;
            if (x.cashPaidCents !== 0 && x.cashPaidCents !== total)
              throw new Error("PAYMENT");
          } else if (x.paymentMode === "credit") {
            credit = total;
            if (x.cashPaidCents !== 0) throw new Error("PAYMENT");
          } else {
            cash = x.cashPaidCents;
            if (cash <= 0 || cash >= total) throw new Error("PAYMENT");
            credit = total - cash;
          }
          let reg: Row | undefined;
          if (cash > 0 && x.paymentSource === "cash_register") {
            [reg] = await tx<
              Row[]
            >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("REGISTER");
          }
          const [settings] = await tx<
              Row[]
            >`select next_purchase_sequence from app_settings where id=1 for update`,
            number = `PUR-${new Date().getUTCFullYear()}-${String(Number(settings!.next_purchase_sequence)).padStart(6, "0")}`;
          await tx`update app_settings set next_purchase_sequence=next_purchase_sequence+1 where id=1`;
          const [purchase] = await tx<
            Row[]
          >`insert into purchases(purchase_number,supplier_id,cash_register_session_id,subtotal_cents,total_cents,paid_cents,remaining_cents,payment_mode,payment_source,invoice_number,invoice_date,reference,notes,idempotency_key,created_by) values(${number},${supplier.id},${reg?.id ?? null},${total},${total},${cash},${credit},${x.paymentMode},${x.paymentSource},${x.invoiceNumber ?? null},${x.invoiceDate ?? null},${x.invoiceNumber ?? null},${x.note ?? null},${x.idempotencyKey},${req.user!.id}) returning *`;
          for (const product of products) {
            const i = map.get(Number(product.id))!,
              before = Number(product.current_stock),
              after = before + i.quantity;
            await tx`insert into purchase_items(purchase_id,product_id,quantity,unit_purchase_price_cents,line_total_cents) values(${purchase!.id},${product.id},${i.quantity},${i.price},${i.quantity * i.price})`;
            await tx`update products set current_stock=${after},purchase_price_cents=${i.price},updated_at=now() where id=${product.id}`;
            await tx`insert into stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by) values(${product.id},'purchase',${i.quantity},${before},${after},'purchase',${purchase!.id},${`Achat ${number}`},${req.user!.id})`;
            await tx`insert into product_price_history(product_id,price_type,old_value_cents,new_value_cents,reason,changed_by) values(${product.id},'purchase_price',${product.purchase_price_cents},${i.price},${`Achat ${number}`},${req.user!.id})`;
          }
          if (credit > 0) {
            const before = Number(supplier.current_debt_cents),
              after = before + credit;
            await tx`update suppliers set current_debt_cents=${after},updated_at=now() where id=${supplier.id}`;
            await tx`insert into supplier_payments(supplier_id,purchase_id,transaction_type,payment_source,amount_cents,balance_before_cents,balance_after_cents,notes,created_by) values(${supplier.id},${purchase!.id},'purchase_credit',${x.paymentSource},${credit},${before},${after},${`Achat ${number}`},${req.user!.id})`;
          }
          if (reg)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg.id},'purchase_cash',${cash},'purchase',${purchase!.id},${`Achat ${number}`},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'purchase.created','purchase',${purchase!.id},${JSON.stringify({ number, total, cash, credit })})`;
          return {
            ...purchaseRow({
              ...purchase,
              supplier_name: supplier.name,
              worker_name: req.user!.fullName,
              item_count: products.length,
            }),
            duplicate: false,
          };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (e) {
        const m = (e as Error).message;
        if (m === "SUPPLIER")
          return bad(reply, "Fournisseur actif introuvable.", 404);
        if (m === "PRODUCT")
          return bad(
            reply,
            "Seuls les produits physiques peuvent être achetés.",
            409,
          );
        if (m === "SERIALIZED_PRODUCT")
          return bad(
            reply,
            "Utilisez la réception par unité pour les produits sérialisés.",
            409,
          );
        if (m === "REGISTER")
          return bad(reply, "Ouvrez une caisse pour la part comptant.", 409);
        if (m === "PAYMENT")
          return bad(reply, "Répartition du paiement invalide.");
        throw e;
      }
    },
  );
  app.get(
    "/api/purchases",
    { preHandler: requirePermission("purchases.view") },
    async (req, reply) => {
      const p = purchaseFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        o = (x.page - 1) * x.pageSize,
        q = `%${x.search}%`,
        rows = await sql<
          Row[]
        >`select p.*,s.name supplier_name,u.full_name worker_name,(select count(*) from purchase_items where purchase_id=p.id)::int item_count,count(*) over() total_count from purchases p join suppliers s on s.id=p.supplier_id join users u on u.id=p.created_by where (${x.search}='' or p.purchase_number ilike ${q} or s.name ilike ${q} or coalesce(p.invoice_number,'') ilike ${q}) and (${x.supplierId ?? null}::int is null or p.supplier_id=${x.supplierId ?? null}) and (${x.paymentMode ?? null}::text is null or p.payment_mode=${x.paymentMode ?? null}) order by p.created_at desc limit ${x.pageSize} offset ${o}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(purchaseRow),
      };
    },
  );
  app.get(
    "/api/purchases/:id",
    { preHandler: requirePermission("purchases.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [r] = await sql<
        Row[]
      >`select p.*,s.name supplier_name,u.full_name worker_name,(select count(*) from purchase_items where purchase_id=p.id)::int item_count from purchases p join suppliers s on s.id=p.supplier_id join users u on u.id=p.created_by where p.id=${p.data.id}`;
      if (!r) return bad(reply, "Achat introuvable.", 404);
      const items = await sql<
        Row[]
      >`select i.*,p.name product_name from purchase_items i join products p on p.id=i.product_id where i.purchase_id=${p.data.id}`;
      return {
        ...purchaseRow(r),
        notes: r.notes,
        items: items.map((i) => ({
          id: Number(i.id),
          productId: Number(i.product_id),
          productName: i.product_name,
          quantity: Number(i.quantity),
          purchaseUnitPriceCents: Number(i.unit_purchase_price_cents),
          lineTotalCents: Number(i.line_total_cents),
        })),
      };
    },
  );

  app.post(
    "/api/expenses",
    { preHandler: requirePermission("expenses.create") },
    async (req, reply) => {
      const p = expenseCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Dépense invalide.");
      const x = p.data;
      try {
        const result = await sql.begin(async (tx) => {
          const [prior] = await tx<
            Row[]
          >`select * from expenses where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior)
            return {
              ...expenseRow({ ...prior, worker_name: req.user!.fullName }),
              duplicate: true,
            };
          let reg: Row | undefined;
          if (x.paymentSource === "cash_register") {
            [reg] = await tx<
              Row[]
            >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("REGISTER");
          }
          const [e] = await tx<
            Row[]
          >`insert into expenses(category,description,amount_cents,cash_register_session_id,payment_source,expense_date,status,notes,idempotency_key,created_by) values(${x.category},${x.description},${x.amountCents},${reg?.id ?? null},${x.paymentSource},${x.expenseDate},'active',${x.note ?? null},${x.idempotencyKey},${req.user!.id}) returning *`;
          if (reg)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg.id},'expense',${x.amountCents},'expense',${e!.id},${x.description},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'expense.created','expense',${e!.id})`;
          return {
            ...expenseRow({ ...e, worker_name: req.user!.fullName }),
            duplicate: false,
          };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (e) {
        if ((e as Error).message === "REGISTER")
          return bad(reply, "Ouvrez une caisse pour cette dépense.", 409);
        throw e;
      }
    },
  );
  app.get(
    "/api/expenses",
    { preHandler: requirePermission("expenses.view") },
    async (req, reply) => {
      const p = expenseFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        o = (x.page - 1) * x.pageSize,
        q = `%${x.search}%`,
        rows = await sql<
          Row[]
        >`select e.*,u.full_name worker_name,count(*) over() total_count from expenses e join users u on u.id=e.created_by where (${x.search}='' or e.description ilike ${q} or e.category ilike ${q}) and (${x.category ?? null}::text is null or e.category=${x.category ?? null}) and (${x.paymentSource ?? null}::text is null or e.payment_source=${x.paymentSource ?? null}) order by e.expense_date desc,e.id desc limit ${x.pageSize} offset ${o}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(expenseRow),
      };
    },
  );
  app.get(
    "/api/expenses/:id",
    { preHandler: requirePermission("expenses.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [r] = await sql<
        Row[]
      >`select e.*,u.full_name worker_name from expenses e join users u on u.id=e.created_by where e.id=${p.data.id}`;
      return r ? expenseRow(r) : bad(reply, "Dépense introuvable.", 404);
    },
  );
  app.post(
    "/api/expenses/:id/correct",
    { preHandler: requirePermission("expenses.correct") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = expenseCorrectionSchema.safeParse(req.body);
      if (!id.success || !p.success) return bad(reply, "Correction invalide.");
      const x = p.data;
      try {
        const result = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${id.data.id},41004)`;
          const [prior] = await tx<
            Row[]
          >`select * from expenses where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior)
            return {
              ...expenseRow({ ...prior, worker_name: req.user!.fullName }),
              duplicate: true,
            };
          const [original] = await tx<
            Row[]
          >`select * from expenses where id=${id.data.id} and status='active' and correction_of_id is null for update`;
          if (!original) throw new Error("EXPENSE");
          let reg: Row | undefined;
          if (original.payment_source === "cash_register") {
            [reg] = await tx<
              Row[]
            >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("REGISTER");
          }
          const [c] = await tx<
            Row[]
          >`insert into expenses(category,description,amount_cents,cash_register_session_id,payment_source,expense_date,status,correction_of_id,correction_reason,notes,idempotency_key,created_by) values(${original.category},${`Correction: ${original.description}`},${-Number(original.amount_cents)},${reg?.id ?? null},${original.payment_source},${original.expense_date},'correction',${original.id},${x.reason},${x.reason},${x.idempotencyKey},${req.user!.id}) returning *`;
          await tx`update expenses set status='corrected',updated_at=now() where id=${original.id}`;
          if (reg)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg.id},'expense_correction',${original.amount_cents},'expense_correction',${c!.id},${x.reason},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'expense.corrected','expense',${original.id},${JSON.stringify({ correctionId: c!.id, reason: x.reason })})`;
          return {
            ...expenseRow({ ...c, worker_name: req.user!.fullName }),
            duplicate: false,
          };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (e) {
        if ((e as Error).message === "EXPENSE")
          return bad(reply, "Dépense introuvable ou déjà corrigée.", 409);
        if ((e as Error).message === "REGISTER")
          return bad(reply, "Ouvrez une caisse pour inverser la dépense.", 409);
        if ((e as { code?: string }).code === "23505")
          return bad(reply, "Dépense déjà corrigée.", 409);
        throw e;
      }
    },
  );

  app.get(
    "/api/sales/:id/returnable-items",
    { preHandler: requirePermission("returns.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [sale] = await sql<
        Row[]
      >`select id,sale_number,status,customer_id,cash_paid_cents,credit_amount_cents from sales where id=${p.data.id}`;
      if (!sale) return bad(reply, "Vente introuvable.", 404);
      const items = await sql<
        Row[]
      >`select id,product_id,product_name_snapshot,product_type_snapshot,quantity,returned_quantity,unit_price_cents,line_total_cents from sale_items where sale_id=${p.data.id} order by id`;
      const serializedUnits = await sql<Row[]>`
        select sale_item_id,barcode,status from product_units
        where sale_id=${p.data.id} order by id`;
      const [prior] = await sql<
        Row[]
      >`select coalesce(sum(customer_debt_reduction_cents),0)::bigint debt,coalesce(sum(cash_refund_cents),0)::bigint cash from returns where original_sale_id=${p.data.id}`;
      return {
        saleId: Number(sale.id),
        saleNumber: sale.sale_number,
        status: sale.status,
        remainingCreditCents: Math.max(
          0,
          Number(sale.credit_amount_cents) - Number(prior!.debt),
        ),
        remainingCashCents: Math.max(
          0,
          Number(sale.cash_paid_cents) - Number(prior!.cash),
        ),
        items: items.map((i) => ({
          id: Number(i.id),
          productId: Number(i.product_id),
          productName: i.product_name_snapshot,
          productType: i.product_type_snapshot,
          quantity: Number(i.quantity),
          returnedQuantity: Number(i.returned_quantity),
          returnableQuantity: Number(i.quantity) - Number(i.returned_quantity),
          unitPriceCents: Number(i.unit_price_cents),
          returnableValueCents:
            (Number(i.quantity) - Number(i.returned_quantity)) *
            Number(i.unit_price_cents),
          unitBarcodes: serializedUnits
            .filter(
              (unit) =>
                Number(unit.sale_item_id) === Number(i.id) &&
                unit.status === "sold",
            )
            .map((unit) => unit.barcode),
        })),
      };
    },
  );
  app.post(
    "/api/returns",
    { preHandler: requirePermission("returns.create") },
    async (req, reply) => {
      const p = returnCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Retour invalide.");
      const x = p.data;
      try {
        const result = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${x.saleId},41003)`;
          const [prior] = await tx<
            Row[]
          >`select * from returns where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior)
            return {
              ...returnRow({
                ...prior,
                sale_number: null,
                customer_name: null,
                worker_name: req.user!.fullName,
              }),
              duplicate: true,
            };
          const [sale] = await tx<
            Row[]
          >`select * from sales where id=${x.saleId} and status in ('completed','partially_returned') for update`;
          if (!sale) throw new Error("SALE");
          const ids = x.items.map((i) => i.saleItemId).sort((a, b) => a - b),
            sold = await tx<
              Row[]
            >`select * from sale_items where sale_id=${x.saleId} and id in ${sql(ids)} order by id for update`;
          if (sold.length !== ids.length) throw new Error("ITEM");
          let total = 0;
          const prepared = [] as {
            input: (typeof x.items)[number];
            row: Row;
            amount: number;
            units: Row[];
          }[];
          for (const input of x.items) {
            const row = sold.find((v) => Number(v.id) === input.saleItemId)!;
            if (
              input.quantity >
              Number(row.quantity) - Number(row.returned_quantity)
            )
              throw new Error("QUANTITY");
            const [productMode] = await tx<Row[]>`
              select inventory_mode from products where id=${row.product_id}`;
            let units: Row[] = [];
            if (productMode?.inventory_mode === "serialized") {
              const codes = (input.unitBarcodes ?? []).map((barcode) =>
                barcode.trim().toLowerCase(),
              );
              if (
                codes.length !== input.quantity ||
                new Set(codes).size !== codes.length
              )
                throw new Error("RETURN_UNIT_REQUIRED");
              units = await tx<Row[]>`
                select * from product_units
                where sale_id=${sale.id} and sale_item_id=${row.id}
                  and lower(trim(barcode)) in ${sql(codes)}
                for update`;
              if (units.length !== codes.length)
                throw new Error("RETURN_UNIT_WRONG_SALE");
              if (units.some((unit) => unit.status !== "sold"))
                throw new Error("RETURN_UNIT_ALREADY_RETURNED");
            } else if ((input.unitBarcodes?.length ?? 0) > 0) {
              throw new Error("RETURN_UNIT_QUANTITY_PRODUCT");
            }
            const amount = input.quantity * Number(row.unit_price_cents);
            total += amount;
            prepared.push({ input, row, amount, units });
          }
          const [priorTotals] = await tx<
              Row[]
            >`select coalesce(sum(customer_debt_reduction_cents),0)::bigint debt,coalesce(sum(cash_refund_cents),0)::bigint cash from returns where original_sale_id=${sale.id}`,
            remainingCredit = Math.max(
              0,
              Number(sale.credit_amount_cents) - Number(priorTotals!.debt),
            ),
            debtReduction = Math.min(total, remainingCredit),
            cashRefund = total - debtReduction;
          let customer: Row | undefined, reg: Row | undefined;
          if (debtReduction > 0) {
            [customer] = await tx<
              Row[]
            >`select * from customers where id=${sale.customer_id} for update`;
            if (
              !customer ||
              Number(customer.current_debt_cents) < debtReduction
            )
              throw new Error("DEBT");
          }
          if (cashRefund > 0) {
            [reg] = await tx<
              Row[]
            >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("REGISTER");
          }
          const settings = await tx<
              Row[]
            >`select next_return_sequence from app_settings where id=1 for update`,
            number = `RET-${new Date().getUTCFullYear()}-${String(Number(settings[0]!.next_return_sequence)).padStart(6, "0")}`;
          await tx`update app_settings set next_return_sequence=next_return_sequence+1 where id=1`;
          const [r] = await tx<
            Row[]
          >`insert into returns(return_number,original_sale_id,customer_id,cash_register_session_id,total_return_value_cents,customer_debt_reduction_cents,cash_refund_cents,reason,idempotency_key,status,created_by) values(${number},${sale.id},${sale.customer_id},${reg?.id ?? null},${total},${debtReduction},${cashRefund},${x.reason},${x.idempotencyKey},'completed',${req.user!.id}) returning *`;
          const productIds = [
              ...new Set(
                prepared
                  .filter(
                    (v) =>
                      v.input.restock &&
                      v.row.product_type_snapshot === "physical_product",
                  )
                  .map((v) => Number(v.row.product_id)),
              ),
            ].sort((a, b) => a - b),
            products = productIds.length
              ? await tx<
                  Row[]
                >`select * from products where id in ${sql(productIds)} order by id for update`
              : [];
          for (const v of prepared) {
            await tx`update sale_items set returned_quantity=returned_quantity+${v.input.quantity} where id=${v.row.id}`;
            const [returnItem] = await tx<Row[]>`
              insert into return_items(return_id,sale_item_id,product_id,quantity,amount_cents,condition,restock)
              values(${r!.id},${v.row.id},${v.row.product_id},${v.input.quantity},${v.amount},${v.input.condition ?? null},${v.row.product_type_snapshot === "physical_product" && v.input.restock})
              returning id`;
            if (v.units.length) {
              const unitIds = v.units.map((unit) => Number(unit.id));
              const nextStatus = v.input.restock ? "available" : "damaged";
              const changed = await tx<Row[]>`
                update product_units
                set status=${nextStatus},return_id=${r!.id},return_item_id=${returnItem!.id},
                    return_condition=${v.input.condition ?? (v.input.restock ? "restocked" : "damaged")},
                    returned_at=now(),updated_at=now()
                where id in ${sql(unitIds)} and status='sold'
                returning id`;
              if (changed.length !== v.units.length)
                throw new Error("RETURN_UNIT_ALREADY_RETURNED");
              if (v.input.restock) {
                const product = products.find(
                  (item) => Number(item.id) === Number(v.row.product_id),
                )!;
                const before = Number(product.current_stock);
                const [reconciled] = await tx<Row[]>`
                  select current_stock from products where id=${product.id}`;
                const after = Number(reconciled!.current_stock);
                product.current_stock = after;
                await tx`insert into stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by)
                  values(${product.id},'customer_return',${v.input.quantity},${before},${after},'return',${r!.id},${x.reason},${req.user!.id})`;
              }
              await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json)
                values(${req.user!.id},${v.input.restock ? "serialized_unit.restocked" : "serialized_unit.damaged"},'product_unit',${unitIds[0] ?? null},${JSON.stringify({ unitIds, returnId: Number(r!.id) })})`;
              await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json)
                values(${req.user!.id},'serialized_unit.returned','product_unit',${unitIds[0] ?? null},${JSON.stringify({ unitIds, returnId: Number(r!.id), result: nextStatus })})`;
            }
            if (
              v.row.product_type_snapshot === "physical_product" &&
              v.input.restock &&
              v.units.length === 0
            ) {
              const product = products.find(
                  (z) => Number(z.id) === Number(v.row.product_id),
                )!,
                before = Number(product.current_stock),
                after = before + v.input.quantity;
              product.current_stock = after;
              await tx`update products set current_stock=${after},updated_at=now() where id=${product.id}`;
              await tx`insert into stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by) values(${product.id},'customer_return',${v.input.quantity},${before},${after},'return',${r!.id},${x.reason},${req.user!.id})`;
            }
          }
          if (debtReduction > 0) {
            const before = Number(customer!.current_debt_cents),
              after = before - debtReduction;
            await tx`update customers set current_debt_cents=${after},updated_at=now() where id=${customer!.id}`;
            await tx`insert into customer_credit_transactions(customer_id,sale_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,notes,created_by) values(${customer!.id},${sale.id},'return',${-debtReduction},${before},${after},${x.reason},${req.user!.id})`;
          }
          if (cashRefund > 0)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg!.id},'customer_refund',${cashRefund},'return',${r!.id},${x.reason},${req.user!.id})`;
          const [remaining] = await tx<
              Row[]
            >`select coalesce(sum(quantity-returned_quantity),0)::int value from sale_items where sale_id=${sale.id}`,
            status =
              Number(remaining!.value) === 0
                ? "fully_returned"
                : "partially_returned";
          await tx`update sales set status=${status},updated_at=now() where id=${sale.id}`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'return.created','return',${r!.id},${JSON.stringify({ total, debtReduction, cashRefund })})`;
          return {
            id: Number(r!.id),
            returnNumber: number,
            totalCents: total,
            debtReductionCents: debtReduction,
            cashRefundCents: cashRefund,
            duplicate: false,
          };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (e) {
        const m = (e as Error).message;
        if (m === "SALE") return bad(reply, "Vente non retournable.", 409);
        if (m === "ITEM" || m === "QUANTITY")
          return bad(reply, "La quantité dépasse le solde retournable.", 409);
        if (m === "RETURN_UNIT_REQUIRED")
          return bad(reply, "Scannez le code exact de chaque unité retournée.", 409);
        if (m === "RETURN_UNIT_WRONG_SALE")
          return bad(reply, "Cette unité ne fait pas partie de cette vente.", 409);
        if (m === "RETURN_UNIT_ALREADY_RETURNED")
          return bad(reply, "Cette unité a déjà été retournée.", 409);
        if (m === "RETURN_UNIT_QUANTITY_PRODUCT")
          return bad(reply, "Ce produit n’utilise pas le suivi par unité.", 409);
        if (m === "DEBT")
          return bad(
            reply,
            "La dette client disponible est insuffisante.",
            409,
          );
        if (m === "REGISTER")
          return bad(
            reply,
            "Ouvrez une caisse pour rembourser les espèces.",
            409,
          );
        throw e;
      }
    },
  );
  app.get(
    "/api/returns",
    { preHandler: requirePermission("returns.view") },
    async (req, reply) => {
      const p = returnFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        o = (x.page - 1) * x.pageSize,
        q = `%${x.search}%`,
        rows = await sql<
          Row[]
        >`select r.*,s.sale_number,c.full_name customer_name,u.full_name worker_name,count(*) over() total_count from returns r join sales s on s.id=r.original_sale_id left join customers c on c.id=r.customer_id join users u on u.id=r.created_by where (${x.search}='' or r.return_number ilike ${q} or s.sale_number ilike ${q}) and (${x.saleId ?? null}::int is null or r.original_sale_id=${x.saleId ?? null}) order by r.created_at desc limit ${x.pageSize} offset ${o}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(returnRow),
      };
    },
  );
  app.get(
    "/api/returns/:id",
    { preHandler: requirePermission("returns.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [r] = await sql<
        Row[]
      >`select r.*,s.sale_number,c.full_name customer_name,u.full_name worker_name from returns r join sales s on s.id=r.original_sale_id left join customers c on c.id=r.customer_id join users u on u.id=r.created_by where r.id=${p.data.id}`;
      if (!r) return bad(reply, "Retour introuvable.", 404);
      const items = await sql<
        Row[]
      >`select i.*,s.product_name_snapshot from return_items i join sale_items s on s.id=i.sale_item_id where i.return_id=${p.data.id}`;
      return {
        ...returnRow(r),
        reason: r.reason,
        items: items.map((i) => ({
          id: Number(i.id),
          saleItemId: Number(i.sale_item_id),
          productName: i.product_name_snapshot,
          quantity: Number(i.quantity),
          amountCents: Number(i.amount_cents),
          restock: Boolean(i.restock),
          condition: i.condition,
        })),
      };
    },
  );
}
