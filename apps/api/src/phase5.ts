import type { FastifyInstance, FastifyReply } from "fastify";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import {
  auditFiltersSchema,
  backupRestoreSchema,
  forcePasswordChangeSchema,
  passwordResetSchema,
  reportFiltersSchema,
  settingsUpdateSchema,
  userCreateSchema,
  userFiltersSchema,
  userUpdateSchema,
} from "@maktaba/validation";
import type { Role } from "@maktaba/shared-types";
import { sql } from "./db/index.js";
import { requirePermission } from "./auth.js";
import { permissions } from "./permissions.js";
import { config } from "./config.js";

type Row = Record<string, unknown>;
const bad = (reply: FastifyReply, message: string, status = 400) =>
  reply
    .code(status)
    .send({ code: status === 404 ? "NOT_FOUND" : "CONFLICT", message });
const pages = (totalRows: number, page: number, pageSize: number) => ({
  page,
  pageSize,
  totalRows,
  totalPages: Math.ceil(totalRows / pageSize),
});
const employee = (r: Row) => ({
  id: Number(r.id),
  displayName: r.full_name,
  username: r.username,
  email: r.email,
  role: r.role,
  isActive: r.is_active,
  mustChangePassword: r.must_change_password,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const temporaryPassword = () => `${randomBytes(8).toString("base64url")}aA7!`;
const safeMetadata = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const blocked = /password|token|secret|cookie|pepper|database|credential/i;
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([key]) => !blocked.test(key))
        .map(([key, item]) => [
          key,
          typeof item === "string" ? item.slice(0, 300) : item,
        ]),
    );
  } catch {
    return null;
  }
};
const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
function range(
  p: ReturnType<typeof reportFiltersSchema.parse>,
  timezone: string,
) {
  const today = todayIn(timezone);
  let start = today,
    end = today;
  if (p.preset === "yesterday") start = end = shift(today, -1);
  if (p.preset === "this_week") {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    start = shift(today, 1 - day);
  }
  if (p.preset === "this_month") start = `${today.slice(0, 8)}01`;
  if (p.preset === "last_month") {
    const first = new Date(`${today.slice(0, 8)}01T12:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() - 1);
    start = first.toISOString().slice(0, 10);
    end = shift(`${today.slice(0, 8)}01`, -1);
  }
  if (p.preset === "custom") {
    if (!p.startDate || !p.endDate) throw new Error("RANGE");
    start = p.startDate;
    end = p.endDate;
  }
  if (
    start > end ||
    (new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 366
  )
    throw new Error("RANGE");
  return { start, end };
}
async function timezone() {
  const [r] = await sql<Row[]>`select timezone from app_settings where id=1`;
  return String(r?.timezone ?? "Africa/Casablanca");
}
const reportPermission: Record<string, string> = {
  sales: "reports.view_sales",
  profit: "reports.view_profit",
  stock: "reports.view_stock",
  customers: "reports.view_customers",
  suppliers: "reports.view_suppliers",
  expenses: "reports.view_expenses",
  workers: "reports.view_workers",
  registers: "reports.view_registers",
};

async function reportData(
  kind: string,
  p: ReturnType<typeof reportFiltersSchema.parse>,
  actor: { id: number; role: Role },
) {
  const tz = await timezone(),
    dates = range(p, tz),
    offset = (p.page - 1) * p.pageSize,
    q = `%${p.search}%`,
    limitedUser = actor.role === "cashier" ? actor.id : p.userId;
  let rows: Row[] = [],
    summary: Row | undefined = {};
  if (kind === "sales") {
    [summary] = await sql<
      Row[]
    >`select coalesce(sum(s.total_cents),0)::bigint gross_cents,coalesce(sum(r.return_cents),0)::bigint returns_cents,coalesce(sum(s.total_cents-coalesce(r.return_cents,0)),0)::bigint net_cents,coalesce(sum(s.cash_paid_cents-coalesce(r.cash_cents,0)),0)::bigint cash_cents,coalesce(sum(s.credit_amount_cents-coalesce(r.debt_cents,0)),0)::bigint credit_cents,count(*)::int sale_count,coalesce(sum(si.units),0)::bigint item_quantity from sales s left join lateral(select sum(total_return_value_cents) return_cents,sum(cash_refund_cents) cash_cents,sum(customer_debt_reduction_cents) debt_cents from returns where original_sale_id=s.id) r on true left join lateral(select sum(quantity-returned_quantity) units from sale_items where sale_id=s.id) si on true where (s.created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${p.paymentMode ?? null}::text is null or s.payment_type=${p.paymentMode ?? null}) and (${limitedUser ?? null}::int is null or s.cashier_id=${limitedUser ?? null})`;
    rows = await sql<
      Row[]
    >`select s.id,s.sale_number,u.full_name worker,coalesce(c.full_name,'') customer,s.payment_type,s.total_cents,coalesce(r.return_cents,0)::bigint returns_cents,(s.total_cents-coalesce(r.return_cents,0))::bigint net_cents,s.cash_paid_cents,s.credit_amount_cents,s.created_at,count(*) over() total_count from sales s join users u on u.id=s.cashier_id left join customers c on c.id=s.customer_id left join lateral(select sum(total_return_value_cents) return_cents from returns where original_sale_id=s.id) r on true where (s.created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${p.paymentMode ?? null}::text is null or s.payment_type=${p.paymentMode ?? null}) and (${limitedUser ?? null}::int is null or s.cashier_id=${limitedUser ?? null}) and (${p.customerId ?? null}::int is null or s.customer_id=${p.customerId ?? null}) and (${p.search}='' or s.sale_number ilike ${q} or coalesce(c.full_name,'') ilike ${q} or exists(select 1 from sale_items i where i.sale_id=s.id and i.product_name_snapshot ilike ${q})) order by s.created_at desc limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "profit") {
    [summary] = await sql<
      Row[]
    >`select coalesce(sum((i.quantity-i.returned_quantity)*i.unit_price_cents),0)::bigint revenue_cents,coalesce(sum((i.quantity-i.returned_quantity)*i.purchase_price_snapshot_cents),0)::bigint cost_cents,coalesce(sum((i.quantity-i.returned_quantity)*(i.unit_price_cents-i.purchase_price_snapshot_cents)),0)::bigint profit_cents from sale_items i join sales s on s.id=i.sale_id where (s.created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${p.categoryId ?? null}::int is null or exists(select 1 from products p2 where p2.id=i.product_id and p2.category_id=${p.categoryId ?? null}))`;
    rows = await sql<
      Row[]
    >`select i.product_id,i.product_name_snapshot product,sum(i.quantity-i.returned_quantity)::int quantity,sum((i.quantity-i.returned_quantity)*i.unit_price_cents)::bigint revenue_cents,sum((i.quantity-i.returned_quantity)*i.purchase_price_snapshot_cents)::bigint cost_cents,sum((i.quantity-i.returned_quantity)*(i.unit_price_cents-i.purchase_price_snapshot_cents))::bigint profit_cents,count(*) over() total_count from sale_items i join sales s on s.id=i.sale_id left join products p2 on p2.id=i.product_id where (s.created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${p.search}='' or i.product_name_snapshot ilike ${q}) and (${p.categoryId ?? null}::int is null or p2.category_id=${p.categoryId ?? null}) group by i.product_id,i.product_name_snapshot order by profit_cents desc limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "stock") {
    [summary] = await sql<
      Row[]
    >`select count(*)::int product_count,coalesce(sum(current_stock),0)::bigint units,coalesce(sum(current_stock*purchase_price_cents),0)::bigint value_cents,count(*) filter(where current_stock<=minimum_stock)::int low_count,count(*) filter(where current_stock=0)::int out_count from products where product_type='physical_product'`;
    rows = await sql<
      Row[]
    >`select p.id,p.name,coalesce(c.name,'') category,p.current_stock,p.minimum_stock,p.purchase_price_cents,(p.current_stock*p.purchase_price_cents)::bigint value_cents,p.is_active,coalesce(m.damaged,0)::int damaged_quantity,coalesce(m.purchased,0)::int purchase_quantity,coalesce(m.sold,0)::int sale_quantity,coalesce(m.restocked,0)::int restocked_quantity,count(*) over() total_count from products p left join categories c on c.id=p.category_id left join lateral(select sum(abs(quantity_change)) filter(where movement_type in ('damaged','loss')) damaged,sum(quantity_change) filter(where movement_type='purchase') purchased,sum(abs(quantity_change)) filter(where movement_type='sale') sold,sum(quantity_change) filter(where movement_type='customer_return') restocked from stock_movements where product_id=p.id and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) m on true where p.product_type='physical_product' and (${p.search}='' or p.name ilike ${q}) and (${p.categoryId ?? null}::int is null or p.category_id=${p.categoryId ?? null}) and (${p.status}='all' or (${p.status}='active' and p.is_active) or (${p.status}='inactive' and not p.is_active) or (${p.status}='low' and p.current_stock<=p.minimum_stock) or (${p.status}='out' and p.current_stock=0)) order by p.name limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "customers") {
    [summary] = await sql<
      Row[]
    >`select count(*)::int customer_count,count(*) filter(where current_debt_cents>0)::int with_debt,coalesce(sum(current_debt_cents),0)::bigint debt_cents from customers`;
    rows = await sql<
      Row[]
    >`select c.id,c.full_name name,c.phone,c.current_debt_cents,c.is_active,coalesce(t.credit_sales,0)::bigint credit_sales_cents,coalesce(t.payments,0)::bigint payments_cents,t.last_transaction,count(*) over() total_count from customers c left join lateral(select sum(amount_cents) filter(where transaction_type='sale') credit_sales,sum(-amount_cents) filter(where transaction_type='payment') payments,max(created_at) last_transaction from customer_credit_transactions where customer_id=c.id and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) t on true where (${p.search}='' or c.full_name ilike ${q} or coalesce(c.phone,'') ilike ${q}) and (${p.status}='all' or c.is_active=${p.status === "active"}) order by c.current_debt_cents desc,c.full_name limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "suppliers") {
    [summary] = await sql<
      Row[]
    >`select count(*)::int supplier_count,count(*) filter(where current_debt_cents>0)::int with_debt,coalesce(sum(current_debt_cents),0)::bigint debt_cents from suppliers`;
    rows = await sql<
      Row[]
    >`select s.id,s.name,s.phone,s.current_debt_cents,s.is_active,coalesce(t.purchases,0)::bigint purchases_cents,coalesce(t.payments,0)::bigint payments_cents,t.last_transaction,count(*) over() total_count from suppliers s left join lateral(select sum(amount_cents) filter(where transaction_type='purchase_credit') purchases,sum(-amount_cents) filter(where transaction_type='supplier_payment') payments,max(created_at) last_transaction from supplier_payments where supplier_id=s.id and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) t on true where (${p.search}='' or s.name ilike ${q} or coalesce(s.phone,'') ilike ${q}) and (${p.status}='all' or s.is_active=${p.status === "active"}) order by s.current_debt_cents desc,s.name limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "expenses") {
    [summary] = await sql<
      Row[]
    >`select coalesce(sum(amount_cents) filter(where correction_of_id is null),0)::bigint gross_cents,coalesce(sum(-amount_cents) filter(where correction_of_id is not null),0)::bigint corrections_cents,coalesce(sum(amount_cents),0)::bigint net_cents,count(*)::int entry_count from expenses where (expense_date at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${limitedUser ?? null}::int is null or created_by=${limitedUser ?? null})`;
    rows = await sql<
      Row[]
    >`select e.id,e.expense_date,e.category,e.description,e.amount_cents,e.payment_source,e.status,u.full_name worker,e.correction_of_id,count(*) over() total_count from expenses e join users u on u.id=e.created_by where (e.expense_date at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${p.search}='' or e.description ilike ${q}) and (${p.category ?? null}::text is null or e.category=${p.category ?? null}) and (${p.paymentSource ?? null}::text is null or e.payment_source=${p.paymentSource ?? null}) and (${limitedUser ?? null}::int is null or e.created_by=${limitedUser ?? null}) order by e.expense_date desc limit ${p.pageSize} offset ${offset}`;
  } else if (kind === "workers") {
    rows = await sql<
      Row[]
    >`select u.id,u.full_name worker,u.role,coalesce(s.sale_count,0)::int sale_count,coalesce(s.net_sales,0)::bigint net_sales_cents,coalesce(s.cash_sales,0)::bigint cash_collected_cents,coalesce(s.credit_sales,0)::bigint credit_sales_cents,coalesce(r.returns,0)::bigint returns_cents,coalesce(p.purchases,0)::int purchases_created,coalesce(e.expenses,0)::bigint expenses_created_cents,coalesce(cr.difference,0)::bigint register_difference_cents,coalesce(d.payments,0)::bigint debt_payments_cents,count(*) over() total_count from users u left join lateral(select count(*) sale_count,sum(total_cents-coalesce(rr.total,0)) net_sales,sum(cash_paid_cents) cash_sales,sum(credit_amount_cents) credit_sales from sales left join lateral(select sum(total_return_value_cents) total from returns where original_sale_id=sales.id) rr on true where cashier_id=u.id and (sales.created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) s on true left join lateral(select sum(total_return_value_cents) returns from returns where created_by=u.id and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) r on true left join lateral(select count(*) purchases from purchases where created_by=u.id and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) p on true left join lateral(select sum(amount_cents) expenses from expenses where created_by=u.id and correction_of_id is null and (expense_date at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) e on true left join lateral(select sum(difference_cents) difference from cash_register_sessions where cashier_id=u.id and (opened_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) cr on true left join lateral(select sum(-amount_cents) payments from customer_credit_transactions where created_by=u.id and transaction_type='payment' and (created_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date) d on true where (${p.search}='' or u.full_name ilike ${q}) order by u.full_name limit ${p.pageSize} offset ${offset}`;
    summary = { worker_count: Number(rows[0]?.total_count ?? 0) };
  } else if (kind === "registers") {
    rows = await sql<
      Row[]
    >`select r.id,u.full_name worker,r.opened_at,r.closed_at,r.status,r.opening_amount_cents,coalesce(m.cash_sales,0)::bigint cash_sales_cents,coalesce(m.debt_payments,0)::bigint debt_payments_cents,coalesce(m.supplier_payments,0)::bigint supplier_payments_cents,coalesce(m.expenses,0)::bigint expenses_cents,coalesce(m.refunds,0)::bigint refunds_cents,r.expected_closing_cents,r.actual_closing_cents,r.difference_cents,count(*) over() total_count from cash_register_sessions r join users u on u.id=r.cashier_id left join lateral(select sum(amount_cents) filter(where movement_type='sale') cash_sales,sum(amount_cents) filter(where movement_type='customer_payment') debt_payments,sum(amount_cents) filter(where movement_type='supplier_payment') supplier_payments,sum(amount_cents) filter(where movement_type='expense') expenses,sum(amount_cents) filter(where movement_type='customer_refund') refunds from cash_movements where cash_register_session_id=r.id) m on true where (r.opened_at at time zone ${tz})::date between ${dates.start}::date and ${dates.end}::date and (${limitedUser ?? null}::int is null or r.cashier_id=${limitedUser ?? null}) order by r.opened_at desc limit ${p.pageSize} offset ${offset}`;
    summary = {
      session_count: Number(rows[0]?.total_count ?? 0),
      difference_cents: rows.reduce(
        (n, r) => n + Number(r.difference_cents ?? 0),
        0,
      ),
    };
  } else throw new Error("REPORT");
  summary ??= {};
  const totalRows = Number(rows[0]?.total_count ?? 0);
  rows = rows.map((row) => {
    const copy = { ...row };
    delete copy.total_count;
    return copy;
  });
  if (kind === "sales") {
    const count = Number(summary.sale_count ?? 0);
    summary.average_order_cents = count
      ? Math.round(Number(summary.net_cents) / count)
      : 0;
  }
  if (kind === "profit") {
    const revenue = Number(summary.revenue_cents ?? 0);
    summary.margin_percent = revenue
      ? Number(((Number(summary.profit_cents) * 100) / revenue).toFixed(2))
      : 0;
  }
  return {
    kind,
    range: dates,
    summary: Object.fromEntries(
      Object.entries(summary).map(([k, v]) => [
        k,
        typeof v === "bigint" ? Number(v) : Number(v ?? 0),
      ]),
    ),
    rows,
    ...pages(totalRows, p.page, p.pageSize),
  };
}

const csvSafe = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
function csv(data: { rows: Row[] }) {
  const headers = data.rows.length ? Object.keys(data.rows[0]!) : [];
  return `\ufeff${headers.map(csvSafe).join(";")}\r\n${data.rows.map((row) => headers.map((h) => csvSafe(row[h])).join(";")).join("\r\n")}${data.rows.length ? "\r\n" : ""}`;
}
const backupRoot = resolve(
  process.cwd(),
  config.NODE_ENV === "test" ? ".backups-test" : "backups",
);
const backupPath = (filename: string) => {
  const path = resolve(backupRoot, filename);
  if (
    dirname(path) !== backupRoot ||
    !/^maktaba-[0-9TZ.-]+-[a-f0-9]{8}\.dump$/.test(filename)
  )
    throw new Error("PATH");
  return path;
};
function docker(args: string[], output?: NodeJS.WritableStream) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["ignore", output ? "pipe" : "ignore", "pipe"],
    });
    let error = "";
    child.stderr?.on("data", (x) => {
      error += String(x).slice(0, 1000);
    });
    if (output && child.stdout)
      void pipeline(child.stdout, output).catch(reject);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`Outil PostgreSQL indisponible (${code}): ${error}`),
          ),
    );
  });
}
function dockerInput(args: string[], input: NodeJS.ReadableStream) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let error = "";
    child.stderr?.on("data", (x) => {
      error += String(x).slice(0, 1000);
    });
    if (child.stdin) void pipeline(input, child.stdin).catch(reject);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`Outil PostgreSQL indisponible (${code}): ${error}`),
          ),
    );
  });
}
async function createBackupFile(filename: string) {
  await mkdir(backupRoot, { recursive: true });
  const file = backupPath(filename),
    url = new URL(config.DATABASE_URL),
    db = url.pathname.slice(1);
  await docker(
    [
      "exec",
      "deploy-postgres-1",
      "pg_dump",
      "-U",
      decodeURIComponent(url.username),
      "-d",
      db,
      "-Fc",
      "--no-owner",
    ],
    createWriteStream(file),
  );
  return file;
}
async function checksum(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export async function registerPhase5(app: FastifyInstance) {
  app.get(
    "/api/roles",
    { preHandler: requirePermission("users.view") },
    async () => ({
      rows: (
        ["global_admin", "manager", "cashier", "stock_worker"] as Role[]
      ).map((role) => ({ role, permissions: permissions(role) })),
    }),
  );
  app.get(
    "/api/permissions",
    { preHandler: requirePermission("users.view") },
    async () => ({ rows: permissions("global_admin") }),
  );
  app.get(
    "/api/users",
    { preHandler: requirePermission("users.view") },
    async (req, reply) => {
      const parsed = userFiltersSchema.safeParse(req.query);
      if (!parsed.success) return bad(reply, "Filtres invalides.");
      const p = parsed.data,
        q = `%${p.search}%`,
        offset = (p.page - 1) * p.pageSize,
        rows = await sql<
          Row[]
        >`select *,count(*) over() total_count from users where (${p.search}='' or full_name ilike ${q} or username ilike ${q} or coalesce(email,'') ilike ${q}) and (${p.role ?? null}::text is null or role=${p.role ?? null}) and (${p.status}='all' or is_active=${p.status === "active"}) order by lower(full_name) limit ${p.pageSize} offset ${offset}`;
      return {
        rows: rows.map(employee),
        ...pages(Number(rows[0]?.total_count ?? 0), p.page, p.pageSize),
      };
    },
  );
  app.post(
    "/api/users",
    {
      preHandler: requirePermission("users.create"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const parsed = userCreateSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Employé invalide.");
      if (
        parsed.data.role === "global_admin" &&
        req.user!.role !== "global_admin"
      )
        return bad(reply, "Rôle interdit.", 403);
      const temp = temporaryPassword();
      try {
        const passwordHash = await argon2.hash(temp),
          result = await sql.begin<{ value: Row }>(async (tx) => {
            const [u] = await tx<
              Row[]
            >`insert into users(full_name,username,email,password_hash,role,must_change_password,created_by) values(${parsed.data.displayName},${parsed.data.username},${parsed.data.email ?? null},${passwordHash},${String(parsed.data.role)},true,${req.user!.id}) returning *`;
            await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'user.created','user',${Number(u!.id)},${JSON.stringify({ role: parsed.data.role })})`;
            return { value: u! };
          });
        return reply
          .code(201)
          .send({ user: employee(result.value), temporaryPassword: temp });
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          return bad(reply, "Nom d’utilisateur ou e-mail déjà utilisé.", 409);
        throw e;
      }
    },
  );
  app.get(
    "/api/users/:id",
    { preHandler: requirePermission("users.view") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const [u] = await sql<Row[]>`select * from users where id=${id}`;
      return u ? employee(u) : bad(reply, "Employé introuvable.", 404);
    },
  );
  app.patch(
    "/api/users/:id",
    {
      preHandler: requirePermission("users.edit"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id),
        parsed = userUpdateSchema.safeParse(req.body);
      if (!Number.isInteger(id) || !parsed.success)
        return bad(reply, "Employé invalide.");
      const x = parsed.data;
      try {
        const result = await sql.begin<{ value: Row }>(async (tx) => {
          const [old] = await tx<
            Row[]
          >`select * from users where id=${id} for update`;
          if (!old) throw new Error("USER");
          const role = String(x.role ?? old.role) as Role;
          if (
            (old.role === "global_admin" || role === "global_admin") &&
            req.user!.role !== "global_admin"
          )
            throw new Error("ROLE");
          if (
            id === req.user!.id &&
            old.role === "global_admin" &&
            role !== "global_admin"
          ) {
            const [count] = await tx<
              Row[]
            >`select count(*)::int value from users where role='global_admin' and is_active and id<>${id}`;
            if (Number(count!.value) === 0) throw new Error("FINAL");
          }
          const [u] = await tx<
            Row[]
          >`update users set full_name=${String(x.displayName ?? old.full_name)},username=${String(x.username ?? old.username)},email=${x.email === undefined ? (old.email as string | null) : x.email},role=${role},updated_at=now() where id=${id} returning *`;
          await tx`insert into audit_logs(user_id,action,entity_type,entity_id,old_values_json,new_values_json) values(${req.user!.id},'user.updated','user',${id},${JSON.stringify({ role: old.role })},${JSON.stringify({ role })})`;
          return { value: u! };
        });
        return employee(result.value);
      } catch (e) {
        const m = (e as Error).message;
        if (m === "USER") return bad(reply, "Employé introuvable.", 404);
        if (m === "ROLE" || m === "FINAL")
          return bad(reply, "Modification de rôle interdite.", 409);
        if ((e as { code?: string }).code === "23505")
          return bad(reply, "Nom d’utilisateur ou e-mail déjà utilisé.", 409);
        throw e;
      }
    },
  );
  for (const action of ["activate", "deactivate"] as const)
    app.post(
      `/api/users/:id/${action}`,
      {
        preHandler: requirePermission(`users.${action}`),
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      },
      async (req, reply) => {
        const id = Number((req.params as { id: string }).id);
        try {
          const result = await sql.begin(async (tx) => {
            const [u] = await tx<
              Row[]
            >`select * from users where id=${id} for update`;
            if (!u) throw new Error("USER");
            if (action === "deactivate" && u.role === "global_admin") {
              const [count] = await tx<
                Row[]
              >`select count(*)::int value from users where role='global_admin' and is_active and id<>${id}`;
              if (Number(count!.value) === 0) throw new Error("FINAL");
            }
            const [updated] = await tx<
              Row[]
            >`update users set is_active=${action === "activate"},updated_at=now() where id=${id} returning *`;
            if (action === "deactivate")
              await tx`update sessions set revoked_at=now() where user_id=${id} and revoked_at is null`;
            await tx`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},${`user.${action}d`},'user',${id})`;
            return updated!;
          });
          return employee(result);
        } catch (e) {
          return bad(
            reply,
            (e as Error).message === "FINAL"
              ? "Le dernier administrateur global actif ne peut pas être désactivé."
              : "Employé introuvable.",
            (e as Error).message === "FINAL" ? 409 : 404,
          );
        }
      },
    );
  app.post(
    "/api/users/:id/reset-password",
    {
      preHandler: requirePermission("users.reset_password"),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id),
        parsed = passwordResetSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Confirmation requise.");
      const temp = temporaryPassword(),
        hash = await argon2.hash(temp);
      const result = await sql.begin(async (tx) => {
        const [u] = await tx<
          Row[]
        >`update users set password_hash=${hash},must_change_password=true,updated_at=now() where id=${id} returning id`;
        if (!u) return null;
        await tx`update sessions set revoked_at=now() where user_id=${id} and revoked_at is null`;
        await tx`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'user.password_reset','user',${id})`;
        return u;
      });
      return result
        ? { temporaryPassword: temp }
        : bad(reply, "Employé introuvable.", 404);
    },
  );
  app.post(
    "/api/users/:id/force-password-change",
    { preHandler: requirePermission("users.reset_password") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id),
        parsed = forcePasswordChangeSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Valeur invalide.");
      const [u] = await sql<
        Row[]
      >`update users set must_change_password=${parsed.data.required},updated_at=now() where id=${id} returning *`;
      if (!u) return bad(reply, "Employé introuvable.", 404);
      await sql`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'user.force_password_change','user',${id},${JSON.stringify({ required: parsed.data.required })})`;
      return employee(u);
    },
  );

  app.get(
    "/api/audit-logs",
    { preHandler: requirePermission("audit.view") },
    async (req, reply) => {
      const parsed = auditFiltersSchema.safeParse(req.query);
      if (!parsed.success) return bad(reply, "Filtres invalides.");
      const p = parsed.data,
        q = `%${p.search}%`,
        offset = (p.page - 1) * p.pageSize,
        rows = await sql<
          Row[]
        >`select a.*,u.full_name worker_name,count(*) over() total_count from audit_logs a left join users u on u.id=a.user_id where (${p.userId ?? null}::int is null or a.user_id=${p.userId ?? null}) and (${p.action}='' or a.action ilike ${`%${p.action}%`}) and (${p.entityType}='' or a.entity_type=${p.entityType}) and (${p.entityId ?? null}::int is null or a.entity_id=${p.entityId ?? null}) and (${p.startDate ?? null}::date is null or a.created_at>=${p.startDate ?? null}::date) and (${p.endDate ?? null}::date is null or a.created_at<(${p.endDate ?? null}::date+1)) and (${p.search}='' or a.action ilike ${q} or a.entity_type ilike ${q} or coalesce(u.full_name,'') ilike ${q}) order by a.created_at desc limit ${p.pageSize} offset ${offset}`;
      return {
        rows: rows.map((r) => ({
          id: Number(r.id),
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id ? Number(r.entity_id) : null,
          workerId: r.user_id ? Number(r.user_id) : null,
          workerName: r.worker_name,
          metadata: safeMetadata(r.new_values_json),
          createdAt: r.created_at,
        })),
        ...pages(Number(rows[0]?.total_count ?? 0), p.page, p.pageSize),
      };
    },
  );

  app.get(
    "/api/reports/dashboard",
    { preHandler: requirePermission("dashboard.view") },
    async (req) => {
      const tz = await timezone(),
        today = todayIn(tz),
        profit = req.user!.permissions.includes("reports.view_profit");
      const [r] = await sql<
        Row[]
      >`select (select coalesce(sum(total_cents),0) from sales where (created_at at time zone ${tz})::date=${today}::date) sales,(select coalesce(sum(cash_paid_cents),0) from sales where (created_at at time zone ${tz})::date=${today}::date) cash,(select coalesce(sum(credit_amount_cents),0) from sales where (created_at at time zone ${tz})::date=${today}::date) credit,(select coalesce(sum(total_return_value_cents),0) from returns where (created_at at time zone ${tz})::date=${today}::date) returns,(select coalesce(sum((quantity-returned_quantity)*(unit_price_cents-purchase_price_snapshot_cents)),0) from sale_items join sales on sales.id=sale_items.sale_id where (sales.created_at at time zone ${tz})::date=${today}::date) profit,(select coalesce(sum(current_debt_cents),0) from customers) customer_debt,(select coalesce(sum(current_debt_cents),0) from suppliers) supplier_debt,(select coalesce(sum(amount_cents),0) from expenses where (expense_date at time zone ${tz})::date=${today}::date) expenses,(select count(*) from products where product_type='physical_product' and is_active and current_stock<=minimum_stock) low,(select count(*) from products where product_type='physical_product' and is_active and current_stock=0) out,(select count(*) from cash_register_sessions where status='open') open_registers`;
      const recent = await sql<
        Row[]
      >`select id,sale_number,total_cents,created_at from sales order by created_at desc limit 5`;
      return {
        salesTodayCents: Number(r!.sales),
        cashSalesTodayCents: Number(r!.cash),
        creditSalesTodayCents: Number(r!.credit),
        returnsTodayCents: Number(r!.returns),
        netSalesTodayCents: Number(r!.sales) - Number(r!.returns),
        estimatedProfitTodayCents: profit ? Number(r!.profit) : null,
        customerDebtCents: Number(r!.customer_debt),
        supplierDebtCents: Number(r!.supplier_debt),
        expensesTodayCents: Number(r!.expenses),
        lowStockCount: Number(r!.low),
        outOfStockCount: Number(r!.out),
        openRegisters: Number(r!.open_registers),
        recentSales: recent.map((x) => ({
          id: Number(x.id),
          saleNumber: x.sale_number,
          totalCents: Number(x.total_cents),
          createdAt: x.created_at,
        })),
      };
    },
  );
  for (const kind of Object.keys(reportPermission))
    app.get(
      `/api/reports/${kind}`,
      { preHandler: requirePermission(reportPermission[kind]!) },
      async (req, reply) => {
        const parsed = reportFiltersSchema.safeParse(req.query);
        if (!parsed.success) return bad(reply, "Filtres de rapport invalides.");
        try {
          return await reportData(kind, parsed.data, req.user!);
        } catch (e) {
          if ((e as Error).message === "RANGE")
            return bad(reply, "Période invalide ou supérieure à 366 jours.");
          throw e;
        }
      },
    );

  app.get(
    "/api/exports/:kind.csv",
    { preHandler: requirePermission("exports.create") },
    async (req, reply) => {
      const kind = (req.params as { kind: string }).kind,
        permission = reportPermission[kind];
      if (!permission || !req.user!.permissions.includes(permission))
        return bad(reply, "Export interdit.", 403);
      const parsed = reportFiltersSchema.safeParse({
        ...(req.query as Record<string, unknown>),
        page: 1,
        pageSize: 5000,
      });
      if (!parsed.success) return bad(reply, "Filtres invalides.");
      const data = await reportData(
        kind,
        { ...parsed.data, page: 1, pageSize: 5000 },
        req.user!,
      );
      if (data.totalRows > 5000)
        return bad(
          reply,
          "Export limité à 5 000 lignes. Réduisez la période.",
          409,
        );
      await sql`insert into audit_logs(user_id,action,entity_type,new_values_json) values(${req.user!.id},'export.created','export',${JSON.stringify({ kind, range: data.range, rows: data.totalRows })})`;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="maktaba-${kind}-${data.range.start}-${data.range.end}.csv"`,
        )
        .send(csv(data));
    },
  );

  app.get(
    "/api/settings",
    { preHandler: requirePermission("settings.view") },
    async () => {
      const [s] = await sql<Row[]>`select * from app_settings where id=1`;
      return {
        shopName: s!.shop_name,
        phone: s!.phone,
        address: s!.address,
        receiptFooter: s!.receipt_footer,
        currency: s!.currency,
        timezone: s!.timezone,
        barcodePrefix: s!.barcode_prefix,
        lowStockDefault: Number(s!.low_stock_default),
        receiptWidth: Number(s!.receipt_width),
        showBarcodeOnReceipt: s!.show_barcode_on_receipt,
        showQrOnLabel: s!.show_qr_on_label,
        showPriceOnLabel: s!.show_price_on_label,
        labelSize: s!.label_size,
        backupRetention: Number(s!.backup_retention),
        sessionTimeoutMinutes: Number(s!.session_timeout_minutes),
      };
    },
  );
  app.patch(
    "/api/settings",
    { preHandler: requirePermission("settings.manage") },
    async (req, reply) => {
      const parsed = settingsUpdateSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Paramètres invalides.");
      try {
        new Intl.DateTimeFormat("fr", {
          timeZone: parsed.data.timezone,
        }).format();
      } catch {
        return bad(reply, "Fuseau horaire invalide.");
      }
      const x = parsed.data;
      await sql.begin(async (tx) => {
        await tx`update app_settings set shop_name=${x.shopName},phone=${x.phone},address=${x.address},receipt_footer=${x.receiptFooter},currency=${x.currency},timezone=${x.timezone},barcode_prefix=${x.barcodePrefix},low_stock_default=${x.lowStockDefault},receipt_width=${x.receiptWidth},show_barcode_on_receipt=${x.showBarcodeOnReceipt},show_qr_on_label=${x.showQrOnLabel},show_price_on_label=${x.showPriceOnLabel},label_size=${x.labelSize},backup_retention=${x.backupRetention},session_timeout_minutes=${x.sessionTimeoutMinutes},updated_at=now() where id=1`;
        await tx`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'settings.updated','settings',1,${JSON.stringify({ timezone: x.timezone, receiptWidth: x.receiptWidth, labelSize: x.labelSize })})`;
      });
      return { ok: true };
    },
  );

  app.get(
    "/api/backups",
    { preHandler: requirePermission("backups.create") },
    async () => ({
      rows: (
        await sql<
          Row[]
        >`select b.*,u.full_name creator_name from backups b join users u on u.id=b.created_by order by b.created_at desc limit 100`
      ).map((b) => ({
        id: Number(b.id),
        filename: b.filename,
        sizeBytes: Number(b.size_bytes),
        checksumSha256: b.checksum_sha256,
        status: b.status,
        creatorName: b.creator_name,
        verifiedAt: b.verified_at,
        createdAt: b.created_at,
      })),
    }),
  );
  app.post(
    "/api/backups",
    { preHandler: requirePermission("backups.create") },
    async (req, reply) => {
      try {
        const result = await sql.begin<{
          recordId: number;
          filename: string;
        }>(async (tx) => {
          await tx`select pg_advisory_xact_lock(51001)`;
          const [busy] = await tx<
            Row[]
          >`select id from backups where status in ('creating','restoring')`;
          if (busy) throw new Error("BUSY");
          const filename = `maktaba-${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}.dump`,
            [record] = await tx<
              Row[]
            >`insert into backups(filename,status,created_by) values(${filename},'creating',${req.user!.id}) returning *`;
          return { recordId: Number(record!.id), filename };
        });
        try {
          const file = await createBackupFile(result.filename),
            info = await stat(file),
            sum = await checksum(file);
          const [done] = await sql<
            Row[]
          >`update backups set size_bytes=${info.size},checksum_sha256=${sum},status='ready' where id=${result.recordId} returning *`;
          await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'backup.created','backup',${Number(done!.id)})`;
          return reply.code(201).send({
            id: Number(done!.id),
            filename: done!.filename,
            sizeBytes: Number(done!.size_bytes),
            checksumSha256: done!.checksum_sha256,
            status: done!.status,
          });
        } catch (e) {
          await sql`update backups set status='failed' where id=${result.recordId}`;
          throw e;
        }
      } catch (e) {
        if ((e as Error).message === "BUSY")
          return bad(
            reply,
            "Une opération de sauvegarde est déjà en cours.",
            409,
          );
        throw e;
      }
    },
  );
  app.post(
    "/api/backups/:id/verify",
    { preHandler: requirePermission("backups.create") },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id),
        [b] = await sql<Row[]>`select * from backups where id=${id}`;
      if (!b) return bad(reply, "Sauvegarde introuvable.", 404);
      try {
        const file = backupPath(String(b.filename)),
          info = await stat(file),
          sum = await checksum(file);
        if (info.size !== Number(b.size_bytes) || sum !== b.checksum_sha256)
          throw new Error("CHECKSUM");
        await dockerInput(
          ["exec", "-i", "deploy-postgres-1", "pg_restore", "--list", "-"],
          createReadStream(file),
        );
        await sql`update backups set status='verified',verified_at=now() where id=${id}`;
        await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${req.user!.id},'backup.verified','backup',${id})`;
        return { ok: true, checksumSha256: sum };
      } catch {
        return bad(reply, "Sauvegarde illisible ou checksum invalide.", 409);
      }
    },
  );
  app.post(
    "/api/backups/:id/restore",
    { preHandler: requirePermission("backups.restore") },
    async (req, reply) => {
      const parsed = backupRestoreSchema.safeParse(req.body);
      if (!parsed.success) return bad(reply, "Confirmation RESTORE requise.");
      const id = Number((req.params as { id: string }).id),
        [b] = await sql<Row[]>`select * from backups where id=${id}`;
      if (!b) return bad(reply, "Sauvegarde introuvable.", 404);
      try {
        const source = backupPath(String(b.filename));
        if ((await checksum(source)) !== b.checksum_sha256)
          throw new Error("CHECKSUM");
        const safetyName = `maktaba-${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}.dump`,
          safetyFile = await createBackupFile(safetyName),
          safetyInfo = await stat(safetyFile),
          safetyChecksum = await checksum(safetyFile);
        await sql`insert into backups(filename,size_bytes,checksum_sha256,status,created_by,verified_at) values(${safetyName},${safetyInfo.size},${safetyChecksum},'verified',${req.user!.id},now())`;
        await sql`update backups set status='restoring' where id=${id}`;
        const url = new URL(config.DATABASE_URL),
          database = url.pathname.slice(1);
        await dockerInput(
          [
            "exec",
            "-i",
            "deploy-postgres-1",
            "pg_restore",
            "-U",
            decodeURIComponent(url.username),
            "-d",
            database,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--exit-on-error",
          ],
          createReadStream(source),
        );
        try {
          await sql`insert into audit_logs(user_id,action,entity_type,entity_id,new_values_json) values(${req.user!.id},'backup.restored','backup',${id},${JSON.stringify({ safetyBackup: safetyName })})`;
        } catch {
          // The restored snapshot may predate the current actor.
        }
        return { ok: true, safetyBackup: safetyName, restartRequired: true };
      } catch {
        try {
          await sql`update backups set status='failed' where id=${id}`;
        } catch {
          // The selected snapshot may already be active.
        }
        return bad(
          reply,
          "Restauration impossible; vérifiez le dump et le mode maintenance.",
          409,
        );
      }
    },
  );
}
