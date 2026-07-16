/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  customerCreateSchema,
  customerFiltersSchema,
  customerUpdateSchema,
  debtPaymentSchema,
  idParamSchema,
  registerCloseSchema,
  registerListFiltersSchema,
  registerMovementFiltersSchema,
  registerOpenSchema,
  saleCreateSchema,
  salesFiltersSchema,
} from "@maktaba/validation";
import { requirePermission } from "./auth.js";
import { sql } from "./db/index.js";

type Row = Record<string, any>;
const bad = (reply: FastifyReply, message: string, code = 400) =>
  reply.code(code).send({
    code:
      code === 409
        ? "CONFLICT"
        : code === 404
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
const denominationTotal = (
  lines: { denominationCents: number; quantity: number }[],
) =>
  lines.reduce((sum, line) => sum + line.denominationCents * line.quantity, 0);
const summary = (row?: Row) => ({
  cashSalesCents: Number(row?.cash_sales_cents ?? 0),
  debtPaymentsCents: Number(row?.debt_payments_cents ?? 0),
  cashMovementCount: Number(row?.cash_movement_count ?? 0),
  saleCount: Number(row?.sale_count ?? 0),
  cashSaleCount: Number(row?.cash_sale_count ?? 0),
});
const expectedQuery = (tx: typeof sql, id: number) => tx<Row[]>`
  select r.opening_amount_cents,
    coalesce(sum(case when m.movement_type in ('cash_sale','customer_debt_payment','register_adjustment_in','expense_correction') then m.amount_cents when m.movement_type in ('register_adjustment_out','purchase_cash','supplier_payment','expense','customer_refund') then -m.amount_cents else 0 end),0)::bigint cash_delta,
    coalesce(sum(m.amount_cents) filter(where m.movement_type='cash_sale'),0)::bigint cash_sales_cents,
    coalesce(sum(m.amount_cents) filter(where m.movement_type='customer_debt_payment'),0)::bigint debt_payments_cents,
    count(m.id)::int cash_movement_count,
    (select count(*)::int from sales where cash_register_session_id=r.id) sale_count,
    (select count(*)::int from sales where cash_register_session_id=r.id and cash_paid_cents>0) cash_sale_count
  from cash_register_sessions r left join cash_movements m on m.cash_register_session_id=r.id
  where r.id=${id} group by r.id`;

export async function registerPhase3(app: FastifyInstance) {
  app.get(
    "/api/register/status",
    { preHandler: requirePermission("register.view") },
    async (req) => {
      const rows = await sql<
        Row[]
      >`select r.*,u.full_name cashier_name from cash_register_sessions r join users u on u.id=r.cashier_id where r.cashier_id=${req.user!.id} and r.status='open' limit 1`;
      if (!rows[0])
        return {
          isOpen: false,
          openingCashCents: 0,
          expectedCashCents: 0,
          currentCashCents: 0,
          summary: summary(),
        };
      const [totals] = await expectedQuery(sql, Number(rows[0].id));
      const opening = Number(rows[0].opening_amount_cents),
        expected = opening + Number(totals?.cash_delta ?? 0);
      return {
        isOpen: true,
        sessionId: Number(rows[0].id),
        cashierId: req.user!.id,
        cashierName: rows[0].cashier_name,
        openedAt: rows[0].opened_at,
        openingCashCents: opening,
        expectedCashCents: expected,
        currentCashCents: expected,
        summary: summary(totals),
      };
    },
  );

  app.post(
    "/api/register/open",
    { preHandler: requirePermission("register.open") },
    async (req, reply) => {
      const parsed = registerOpenSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Données d’ouverture invalides.");
      const x = parsed.data;
      if (
        x.denominations &&
        denominationTotal(x.denominations) !== x.openingCashCents
      )
        return bad(
          reply,
          "Le total des coupures doit correspondre au fonds de caisse.",
        );
      try {
        const result = await sql.begin(async (tx) => {
          const prior = await tx<
            Row[]
          >`select id,opening_amount_cents,opened_at from cash_register_sessions where cashier_id=${req.user!.id} and opening_idempotency_key=${x.idempotencyKey} limit 1`;
          if (prior[0])
            return {
              id: Number(prior[0].id),
              openingCashCents: Number(prior[0].opening_amount_cents),
              openedAt: prior[0].opened_at,
              duplicate: true,
            };
          await tx`select pg_advisory_xact_lock(${req.user!.id},31001)`;
          const open = await tx<
            Row[]
          >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
          if (open.length)
            throw Object.assign(new Error("OPEN_REGISTER"), {
              statusCode: 409,
            });
          const [created] = await tx<
            Row[]
          >`insert into cash_register_sessions(cashier_id,opening_amount_cents,opening_note,opening_idempotency_key) values(${req.user!.id},${x.openingCashCents},${x.note ?? null},${x.idempotencyKey}) returning id,opened_at`;
          for (const line of x.denominations ?? [])
            if (line.quantity)
              await tx`insert into cash_register_denominations(cash_register_session_id,denomination_cents,quantity,total_cents,phase) values(${created!.id},${line.denominationCents},${line.quantity},${line.denominationCents * line.quantity},'opening')`;
          await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reason,created_by) values(${created!.id},'register_opening',${x.openingCashCents},${x.note ?? "Ouverture de caisse"},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'register.opened','cash_register',${created!.id},${JSON.stringify({ openingCashCents: x.openingCashCents })})`;
          return {
            id: Number(created!.id),
            openingCashCents: x.openingCashCents,
            openedAt: created!.opened_at,
            duplicate: false,
          };
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        if (
          (error as Error).message === "OPEN_REGISTER" ||
          (error as { code?: string }).code === "23505"
        )
          return bad(reply, "Vous avez déjà une caisse ouverte.", 409);
        throw error;
      }
    },
  );

  app.post(
    "/api/register/close",
    { preHandler: requirePermission("register.close") },
    async (req, reply) => {
      const parsed = registerCloseSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Données de clôture invalides.");
      const x = parsed.data,
        actual = denominationTotal(x.denominations);
      if (actual !== x.actualCashCents)
        return bad(
          reply,
          "Le total des coupures ne correspond pas au montant réel.",
        );
      return sql.begin(async (tx) => {
        const duplicate = await tx<
          Row[]
        >`select id,expected_closing_cents,actual_closing_cents,difference_cents from cash_register_sessions where cashier_id=${req.user!.id} and closing_idempotency_key=${x.idempotencyKey}`;
        if (duplicate[0])
          return {
            id: Number(duplicate[0].id),
            expectedCashCents: Number(duplicate[0].expected_closing_cents),
            actualCashCents: Number(duplicate[0].actual_closing_cents),
            differenceCents: Number(duplicate[0].difference_cents),
            duplicate: true,
          };
        const rows = await tx<
          Row[]
        >`select * from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
        if (!rows[0]) return bad(reply, "Aucune caisse ouverte.", 409);
        const [totals] = await expectedQuery(
          tx as unknown as typeof sql,
          Number(rows[0].id),
        );
        const expected =
            Number(rows[0].opening_amount_cents) +
            Number(totals?.cash_delta ?? 0),
          difference = actual - expected;
        if (difference !== 0 && !x.differenceReason?.trim())
          return bad(reply, "Un motif est obligatoire en cas d’écart.");
        for (const line of x.denominations)
          if (line.quantity)
            await tx`insert into cash_register_denominations(cash_register_session_id,denomination_cents,quantity,total_cents,phase) values(${rows[0].id},${line.denominationCents},${line.quantity},${line.denominationCents * line.quantity},'closing')`;
        const [closed] = await tx<
          Row[]
        >`update cash_register_sessions set status='closed',closed_at=now(),expected_closing_cents=${expected},actual_closing_cents=${actual},difference_cents=${difference},difference_reason=${x.differenceReason ?? null},closing_note=${x.note ?? null},closing_idempotency_key=${x.idempotencyKey},updated_at=now() where id=${rows[0].id} and status='open' returning id,closed_at`;
        if (!closed) return bad(reply, "La caisse vient d’être clôturée.", 409);
        await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reason,created_by) values(${closed.id},'register_closing',${actual},${x.note ?? "Clôture de caisse"},${req.user!.id})`;
        await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'register.closed','cash_register',${closed.id},${JSON.stringify({ expected, actual, difference })})`;
        return {
          id: Number(closed.id),
          expectedCashCents: expected,
          actualCashCents: actual,
          differenceCents: difference,
          closedAt: closed.closed_at,
          duplicate: false,
        };
      });
    },
  );

  app.get(
    "/api/register/sessions",
    { preHandler: requirePermission("register.view") },
    async (req, reply) => {
      const p = registerListFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        offset = (x.page - 1) * x.pageSize,
        role = req.user!.role;
      const rows = await sql<
        Row[]
      >`select r.*,u.full_name cashier_name,count(*) over() total_count from cash_register_sessions r join users u on u.id=r.cashier_id where (${role} in ('global_admin','manager') or r.cashier_id=${req.user!.id}) and (${x.status}='all' or r.status=${x.status}) order by r.opened_at desc limit ${x.pageSize} offset ${offset}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(registerRow),
      };
    },
  );
  app.get(
    "/api/register/sessions/:id",
    { preHandler: requirePermission("register.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const rows = await sql<
        Row[]
      >`select r.*,u.full_name cashier_name from cash_register_sessions r join users u on u.id=r.cashier_id where r.id=${p.data.id} and (${req.user!.role} in ('global_admin','manager') or r.cashier_id=${req.user!.id})`;
      if (!rows[0]) return bad(reply, "Session de caisse introuvable.", 404);
      const den = await sql<
        Row[]
      >`select denomination_cents,quantity,total_cents,phase from cash_register_denominations where cash_register_session_id=${p.data.id} order by phase,denomination_cents desc`;
      const [totals] = await expectedQuery(sql, p.data.id);
      return {
        ...registerRow(rows[0]),
        denominations: den.map((d) => ({
          denominationCents: Number(d.denomination_cents),
          quantity: Number(d.quantity),
          totalCents: Number(d.total_cents),
          phase: d.phase,
        })),
        summary: summary(totals),
      };
    },
  );
  app.get(
    "/api/register/movements",
    { preHandler: requirePermission("register.movements.view") },
    async (req, reply) => {
      const p = registerMovementFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        offset = (x.page - 1) * x.pageSize;
      const rows = await sql<
        Row[]
      >`select m.*,u.full_name worker_name,r.cashier_id,count(*) over() total_count from cash_movements m join users u on u.id=m.created_by join cash_register_sessions r on r.id=m.cash_register_session_id where (${req.user!.role} in ('global_admin','manager') or r.cashier_id=${req.user!.id}) and (${x.sessionId ?? null}::int is null or m.cash_register_session_id=${x.sessionId ?? null}) and (${x.movementType ?? null}::text is null or m.movement_type=${x.movementType ?? null}) and (${x.startDate ?? null}::date is null or m.created_at>=${x.startDate ?? null}::date) and (${x.endDate ?? null}::date is null or m.created_at<(${x.endDate ?? null}::date+1)) order by m.created_at desc limit ${x.pageSize} offset ${offset}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(movementRow),
      };
    },
  );

  app.get(
    "/api/customers",
    { preHandler: requirePermission("customers.view") },
    async (req, reply) => {
      const p = customerFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        offset = (x.page - 1) * x.pageSize,
        pattern = `%${x.search}%`,
        order =
          x.sort === "currentDebtCents"
            ? sql`c.current_debt_cents`
            : x.sort === "createdAt"
              ? sql`c.created_at`
              : sql`lower(c.full_name)`,
        direction = x.direction === "desc" ? sql`desc` : sql`asc`;
      const rows = await sql<
        Row[]
      >`select c.*,count(*) over() total_count from customers c where (${x.search}='' or c.full_name ilike ${pattern} or coalesce(c.phone,'') ilike ${pattern} or coalesce(c.email,'') ilike ${pattern}) and (${x.status}='all' or c.is_active=${x.status === "active"}) and (${!x.debtOnly} or c.current_debt_cents>0) order by ${order} ${direction},c.id limit ${x.pageSize} offset ${offset}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(customerRow),
      };
    },
  );
  app.post(
    "/api/customers",
    { preHandler: requirePermission("customers.manage") },
    async (req, reply) => {
      const p = customerCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Données client invalides.");
      const x = p.data;
      const phone = normalizePhone(x.phone),
        email = x.email ?? null,
        address = x.address ?? null,
        notes = x.notes ?? null;
      const [row] = await sql<
        Row[]
      >`insert into customers(full_name,phone,email,address,notes,credit_limit_cents,created_by) values(${x.name},${phone},${email},${address},${notes},${x.creditLimitCents},${req.user!.id}) returning *`;
      await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'customer.created','customer',${row!.id})`;
      return reply.code(201).send(customerRow(row!));
    },
  );
  app.get(
    "/api/customers/:id",
    { preHandler: requirePermission("customers.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [row] = await sql<
        Row[]
      >`select * from customers where id=${p.data.id}`;
      if (!row) return bad(reply, "Client introuvable.", 404);
      return customerRow(row);
    },
  );
  app.patch(
    "/api/customers/:id",
    { preHandler: requirePermission("customers.manage") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = customerUpdateSchema.safeParse(req.body);
      if (!id.success || !p.success)
        return bad(reply, "Données client invalides.");
      const x = p.data,
        [before] = await sql<
          Row[]
        >`select * from customers where id=${id.data.id}`;
      if (!before) return bad(reply, "Client introuvable.", 404);
      const [row] = await sql<
        Row[]
      >`update customers set full_name=${x.name ?? before.full_name},phone=${x.phone === undefined ? before.phone : normalizePhone(x.phone)},email=${x.email === undefined ? before.email : x.email},address=${x.address === undefined ? before.address : x.address},notes=${x.notes === undefined ? before.notes : x.notes},credit_limit_cents=${x.creditLimitCents ?? before.credit_limit_cents},updated_at=now() where id=${id.data.id} returning *`;
      await sql`insert into audit_logs(user_id,action,entity_type,entity_id,old_values_json,new_values_json) values(${req.user!.id},'customer.updated','customer',${id.data.id},${JSON.stringify(customerRow(before))},${JSON.stringify(customerRow(row!))})`;
      return customerRow(row!);
    },
  );
  for (const action of ["activate", "deactivate"] as const)
    app.post(
      `/api/customers/:id/${action}`,
      { preHandler: requirePermission("customers.manage") },
      async (req, reply) => {
        const p = idParamSchema.safeParse(req.params);
        if (!p.success) return bad(reply, "Identifiant invalide.");
        const [row] = await sql<
          Row[]
        >`update customers set is_active=${action === "activate"},updated_at=now() where id=${p.data.id} returning *`;
        if (!row) return bad(reply, "Client introuvable.", 404);
        await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},${`customer.${action}d`},'customer',${p.data.id})`;
        return customerRow(row);
      },
    );
  app.get(
    "/api/customers/:id/credit-transactions",
    { preHandler: requirePermission("credit.view") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        q = registerListFiltersSchema
          .pick({ page: true, pageSize: true })
          .safeParse(req.query);
      if (!id.success || !q.success) return bad(reply, "Filtres invalides.");
      const x = q.data,
        offset = (x.page - 1) * x.pageSize,
        rows = await sql<
          Row[]
        >`select t.*,u.full_name worker_name,count(*) over() total_count from customer_credit_transactions t join users u on u.id=t.created_by where t.customer_id=${id.data.id} order by t.created_at desc limit ${x.pageSize} offset ${offset}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(creditRow),
      };
    },
  );
  app.post(
    "/api/customers/:id/payments",
    { preHandler: requirePermission("credit.manage") },
    async (req, reply) => {
      const id = idParamSchema.safeParse(req.params),
        p = debtPaymentSchema.safeParse(req.body);
      if (!id.success || !p.success) return bad(reply, "Paiement invalide.");
      const x = p.data;
      try {
        const result = await sql.begin(async (tx) => {
          const prior = await tx<
            Row[]
          >`select id,balance_after_cents from customer_credit_transactions where created_by=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior[0])
            return {
              transactionId: Number(prior[0].id),
              remainingDebtCents: Number(prior[0].balance_after_cents),
              duplicate: true,
            };
          const [reg] = await tx<
            Row[]
          >`select id from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
          if (!reg) throw new Error("NO_REGISTER");
          const [customer] = await tx<
            Row[]
          >`select * from customers where id=${id.data.id} and is_active=true for update`;
          if (!customer) throw new Error("NO_CUSTOMER");
          const before = Number(customer.current_debt_cents);
          if (x.amountCents > before) throw new Error("EXCESS");
          const after = before - x.amountCents;
          await tx`update customers set current_debt_cents=${after},updated_at=now() where id=${id.data.id}`;
          const [ledger] = await tx<
            Row[]
          >`insert into customer_credit_transactions(customer_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,notes,cash_register_session_id,idempotency_key,created_by) values(${id.data.id},'debt_payment',${-x.amountCents},${before},${after},${x.note ?? null},${reg.id},${x.idempotencyKey},${req.user!.id}) returning id`;
          await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg.id},'customer_debt_payment',${x.amountCents},'customer_credit_transaction',${ledger!.id},${x.note ?? "Règlement dette client"},${req.user!.id})`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'customer.debt_paid','customer',${id.data.id},${JSON.stringify({ amountCents: x.amountCents, before, after })})`;
          return {
            transactionId: Number(ledger!.id),
            remainingDebtCents: after,
            duplicate: false,
          };
        });
        return result;
      } catch (e) {
        const m = (e as Error).message;
        if (m === "NO_REGISTER")
          return bad(reply, "Ouvrez une caisse avant d’encaisser.", 409);
        if (m === "NO_CUSTOMER")
          return bad(reply, "Client actif introuvable.", 404);
        if (m === "EXCESS")
          return bad(reply, "Le paiement dépasse la dette actuelle.", 409);
        if ((e as { code?: string }).code === "23505")
          return bad(reply, "Paiement déjà traité.", 409);
        throw e;
      }
    },
  );

  app.post(
    "/api/sales",
    { preHandler: requirePermission("sales.create") },
    async (req, reply) => {
      const p = saleCreateSchema.safeParse(req.body);
      if (!p.success) return bad(reply, "Vente invalide.");
      const x = p.data,
        merged = new Map<number, number>();
      for (const line of x.items)
        merged.set(
          line.productId,
          (merged.get(line.productId) ?? 0) + line.quantity,
        );
      try {
        const result = await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${req.user!.id},31002)`;
          const prior = await tx<
            Row[]
          >`select * from sales where cashier_id=${req.user!.id} and idempotency_key=${x.idempotencyKey}`;
          if (prior[0]) return saleResult(prior[0], true);
          const ids = [...merged.keys()].sort((a, b) => a - b),
            products = await tx<
              Row[]
            >`select * from products where id in ${sql(ids)} order by id for update`;
          if (products.length !== ids.length) throw new Error("PRODUCT");
          let total = 0;
          for (const product of products) {
            if (!product.is_active) throw new Error("INACTIVE");
            const qty = merged.get(Number(product.id))!,
              price = Number(product.selling_price_cents);
            if (
              product.product_type === "physical_product" &&
              product.track_stock &&
              Number(product.current_stock) < qty
            )
              throw new Error("STOCK");
            total += qty * price;
          }
          let cash = 0,
            credit = 0;
          if (x.paymentMode === "cash") {
            cash = total;
            if (x.cashPaidCents !== 0 && x.cashPaidCents !== total)
              throw new Error("ALLOCATION");
          } else if (x.paymentMode === "credit") {
            credit = total;
            if (x.cashPaidCents !== 0) throw new Error("ALLOCATION");
          } else {
            cash = x.cashPaidCents;
            if (cash <= 0 || cash >= total) throw new Error("ALLOCATION");
            credit = total - cash;
          }
          if (credit > 0 && !x.customerId) throw new Error("CUSTOMER_REQUIRED");
          let reg: Row | undefined;
          if (cash > 0) {
            [reg] = await tx<
              Row[]
            >`select * from cash_register_sessions where cashier_id=${req.user!.id} and status='open' for update`;
            if (!reg) throw new Error("NO_REGISTER");
          }
          let customer: Row | undefined,
            beforeDebt = 0;
          if (credit > 0) {
            const customerId = x.customerId ?? null;
            [customer] = await tx<
              Row[]
            >`select * from customers where id=${customerId} and is_active=true for update`;
            if (!customer) throw new Error("CUSTOMER");
            beforeDebt = Number(customer.current_debt_cents);
            if (
              Number(customer.credit_limit_cents) > 0 &&
              beforeDebt + credit > Number(customer.credit_limit_cents)
            )
              throw new Error("LIMIT");
          }
          const [setting] = await tx<
            Row[]
          >`select next_sale_sequence from app_settings where id=1 for update`;
          const sequence = Number(setting?.next_sale_sequence ?? 1),
            number = `SALE-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
          await tx`update app_settings set next_sale_sequence=next_sale_sequence+1,updated_at=now() where id=1`;
          const [sale] = await tx<
            Row[]
          >`insert into sales(sale_number,customer_id,cashier_id,cash_register_session_id,subtotal_cents,discount_cents,total_cents,cash_paid_cents,credit_amount_cents,change_cents,payment_type,status,notes,idempotency_key) values(${number},${x.customerId ?? null},${req.user!.id},${reg?.id ?? null},${total},0,${total},${cash},${credit},0,${x.paymentMode},'completed',${x.note ?? null},${x.idempotencyKey}) returning *`;
          for (const product of products) {
            const qty = merged.get(Number(product.id))!,
              line = qty * Number(product.selling_price_cents);
            await tx`insert into sale_items(sale_id,product_id,product_name_snapshot,sku_snapshot,barcode_snapshot,product_type_snapshot,quantity,unit_price_cents,purchase_price_snapshot_cents,discount_cents,line_total_cents) values(${sale!.id},${product.id},${product.name},${product.sku},${product.internal_barcode},${product.product_type},${qty},${product.selling_price_cents},${product.purchase_price_cents},0,${line})`;
            if (
              product.product_type === "physical_product" &&
              product.track_stock
            ) {
              const before = Number(product.current_stock),
                after = before - qty;
              await tx`update products set current_stock=${after},updated_at=now() where id=${product.id}`;
              await tx`insert into stock_movements(product_id,movement_type,quantity_change,stock_before,stock_after,reference_type,reference_id,reason,created_by) values(${product.id},'sale',${-qty},${before},${after},'sale',${sale!.id},'Vente',${req.user!.id})`;
            }
          }
          if (cash > 0)
            await tx`insert into cash_movements(cash_register_session_id,movement_type,amount_cents,reference_type,reference_id,reason,created_by) values(${reg!.id},'cash_sale',${cash},'sale',${sale!.id},${`Vente ${number}`},${req.user!.id})`;
          if (credit > 0) {
            const after = beforeDebt + credit;
            await tx`update customers set current_debt_cents=${after},updated_at=now() where id=${customer!.id}`;
            await tx`insert into customer_credit_transactions(customer_id,sale_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,notes,created_by) values(${customer!.id},${sale!.id},'credit_sale',${credit},${beforeDebt},${after},${x.note ?? `Vente ${number}`},${req.user!.id})`;
          }
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'sale.created','sale',${sale!.id},${JSON.stringify({ number, total, cash, credit })})`;
          return saleResult(sale!, false);
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (e) {
        const m = (e as Error).message;
        if (m === "STOCK") return bad(reply, "Stock insuffisant.", 409);
        if (m === "INACTIVE")
          return bad(reply, "Un produit est désactivé.", 409);
        if (m === "PRODUCT") return bad(reply, "Produit introuvable.", 404);
        if (m === "NO_REGISTER")
          return bad(reply, "Ouvrez une caisse pour la part comptant.", 409);
        if (m === "CUSTOMER_REQUIRED" || m === "CUSTOMER")
          return bad(
            reply,
            "Un client actif est obligatoire pour le crédit.",
            409,
          );
        if (m === "LIMIT")
          return bad(
            reply,
            "La limite de crédit du client serait dépassée.",
            409,
          );
        if (m === "ALLOCATION")
          return bad(reply, "La répartition du paiement est invalide.");
        if ((e as { code?: string }).code === "23505")
          return bad(reply, "Cette vente a déjà été traitée.", 409);
        throw e;
      }
    },
  );
  app.get(
    "/api/sales",
    { preHandler: requirePermission("sales.view") },
    async (req, reply) => {
      const p = salesFiltersSchema.safeParse(req.query);
      if (!p.success) return bad(reply, "Filtres invalides.");
      const x = p.data,
        offset = (x.page - 1) * x.pageSize,
        pattern = `%${x.search}%`,
        order =
          x.sort === "totalCents"
            ? sql`s.total_cents`
            : x.sort === "saleNumber"
              ? sql`s.sale_number`
              : sql`s.created_at`,
        direction = x.direction === "asc" ? sql`asc` : sql`desc`;
      const rows = await sql<
        Row[]
      >`select s.*,c.full_name customer_name,u.full_name worker_name,count(si.id)::int item_count,count(*) over() total_count from sales s left join customers c on c.id=s.customer_id join users u on u.id=s.cashier_id join sale_items si on si.sale_id=s.id where (${x.search}='' or s.sale_number ilike ${pattern} or coalesce(c.full_name,'') ilike ${pattern}) and (${x.customerId ?? null}::int is null or s.customer_id=${x.customerId ?? null}) and (${x.workerId ?? null}::int is null or s.cashier_id=${x.workerId ?? null}) and (${x.paymentMode ?? null}::text is null or s.payment_type=${x.paymentMode ?? null}) and (${x.startDate ?? null}::date is null or s.created_at>=${x.startDate ?? null}::date) and (${x.endDate ?? null}::date is null or s.created_at<(${x.endDate ?? null}::date+1)) and (${x.minAmountCents ?? null}::bigint is null or s.total_cents>=${x.minAmountCents ?? null}) and (${x.maxAmountCents ?? null}::bigint is null or s.total_cents<=${x.maxAmountCents ?? null}) group by s.id,c.full_name,u.full_name order by ${order} ${direction},s.id desc limit ${x.pageSize} offset ${offset}`;
      return {
        ...pages(Number(rows[0]?.total_count ?? 0), x.page, x.pageSize),
        rows: rows.map(saleRow),
      };
    },
  );
  app.get(
    "/api/sales/:id",
    { preHandler: requirePermission("sales.view") },
    async (req, reply) => {
      const p = idParamSchema.safeParse(req.params);
      if (!p.success) return bad(reply, "Identifiant invalide.");
      const [row] = await sql<
        Row[]
      >`select s.*,c.full_name customer_name,u.full_name worker_name,(select count(*) from sale_items where sale_id=s.id)::int item_count,a.shop_name,a.phone shop_phone,a.address shop_address,a.receipt_footer from sales s left join customers c on c.id=s.customer_id join users u on u.id=s.cashier_id cross join app_settings a where s.id=${p.data.id}`;
      if (!row) return bad(reply, "Vente introuvable.", 404);
      const items = await sql<
          Row[]
        >`select * from sale_items where sale_id=${p.data.id} order by id`,
        moves = req.user!.permissions.includes("stock.view")
          ? await sql<
              Row[]
            >`select m.*,p.name product_name,u.full_name worker_name from stock_movements m join products p on p.id=m.product_id join users u on u.id=m.created_by where m.reference_type='sale' and m.reference_id=${p.data.id}`
          : [],
        [credit] = await sql<
          Row[]
        >`select t.*,u.full_name worker_name from customer_credit_transactions t join users u on u.id=t.created_by where t.sale_id=${p.data.id}`;
      return {
        ...saleRow(row),
        registerSessionId: row.cash_register_session_id
          ? Number(row.cash_register_session_id)
          : null,
        notes: row.notes,
        shopName: row.shop_name,
        shopPhone: row.shop_phone,
        shopAddress: row.shop_address,
        receiptFooter: row.receipt_footer,
        items: items.map((i) => ({
          id: Number(i.id),
          productId: Number(i.product_id),
          productName: i.product_name_snapshot,
          productType: i.product_type_snapshot,
          sku: i.sku_snapshot,
          barcode: i.barcode_snapshot,
          quantity: Number(i.quantity),
          unitPriceCents: Number(i.unit_price_cents),
          lineTotalCents: Number(i.line_total_cents),
        })),
        stockMovements: moves.map((m) => ({
          id: Number(m.id),
          productId: Number(m.product_id),
          productName: m.product_name,
          movementType: m.movement_type,
          quantityChange: Number(m.quantity_change),
          stockBefore: Number(m.stock_before),
          stockAfter: Number(m.stock_after),
          workerId: Number(m.created_by),
          workerName: m.worker_name,
          reason: m.reason,
          referenceType: m.reference_type,
          referenceId: Number(m.reference_id),
          createdAt: m.created_at,
        })),
        creditTransaction: credit ? creditRow(credit) : null,
      };
    },
  );
}

const normalizePhone = (value: string | null | undefined) =>
  value?.replace(/[\s().-]/g, "") || null;
const customerRow = (r: Row) => ({
  id: Number(r.id),
  name: r.full_name,
  phone: r.phone,
  email: r.email,
  address: r.address,
  notes: r.notes,
  creditLimitCents: Number(r.credit_limit_cents),
  currentDebtCents: Number(r.current_debt_cents),
  isActive: Boolean(r.is_active),
  createdBy: r.created_by ? Number(r.created_by) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const registerRow = (r: Row) => ({
  id: Number(r.id),
  cashierId: Number(r.cashier_id),
  cashierName: r.cashier_name,
  openedAt: r.opened_at,
  openingCashCents: Number(r.opening_amount_cents),
  closedAt: r.closed_at,
  expectedCashCents:
    r.expected_closing_cents === null ? null : Number(r.expected_closing_cents),
  actualCashCents:
    r.actual_closing_cents === null ? null : Number(r.actual_closing_cents),
  differenceCents:
    r.difference_cents === null ? null : Number(r.difference_cents),
  differenceReason: r.difference_reason,
  openingNote: r.opening_note,
  closingNote: r.closing_note,
  status: r.status,
});
const movementRow = (r: Row) => ({
  id: Number(r.id),
  registerSessionId: Number(r.cash_register_session_id),
  movementType: r.movement_type,
  amountCents: Number(r.amount_cents),
  direction: ["register_adjustment_out"].includes(String(r.movement_type))
    ? "out"
    : "in",
  reason: r.reason,
  referenceType: r.reference_type,
  referenceId: r.reference_id ? Number(r.reference_id) : null,
  workerId: Number(r.created_by),
  workerName: r.worker_name,
  createdAt: r.created_at,
});
const creditRow = (r: Row) => ({
  id: Number(r.id),
  customerId: Number(r.customer_id),
  saleId: r.sale_id ? Number(r.sale_id) : null,
  registerSessionId: r.cash_register_session_id
    ? Number(r.cash_register_session_id)
    : null,
  transactionType: r.transaction_type,
  amountCents: Number(r.amount_cents),
  balanceBeforeCents: Number(
    r.balance_before_cents ??
      Number(r.balance_after_cents) - Number(r.amount_cents),
  ),
  balanceAfterCents: Number(r.balance_after_cents),
  notes: r.notes,
  workerId: Number(r.created_by),
  workerName: r.worker_name,
  createdAt: r.created_at,
});
const saleResult = (r: Row, duplicate: boolean) => ({
  id: Number(r.id),
  saleNumber: r.sale_number,
  subtotalCents: Number(r.subtotal_cents),
  totalCents: Number(r.total_cents),
  cashPaidCents: Number(r.cash_paid_cents),
  creditAmountCents: Number(r.credit_amount_cents),
  paymentMode: r.payment_type,
  duplicate,
});
const saleRow = (r: Row) => ({
  id: Number(r.id),
  saleNumber: r.sale_number,
  createdAt: r.created_at,
  customerId: r.customer_id ? Number(r.customer_id) : null,
  customerName: r.customer_name ?? null,
  workerId: Number(r.cashier_id),
  workerName: r.worker_name,
  itemCount: Number(r.item_count),
  totalCents: Number(r.total_cents),
  cashPaidCents: Number(r.cash_paid_cents),
  creditAmountCents: Number(r.credit_amount_cents),
  paymentMode: r.payment_type,
  status: r.status,
});
