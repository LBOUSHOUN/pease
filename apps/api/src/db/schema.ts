import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const ts = (n: string) =>
  timestamp(n, { withTimezone: true }).notNull().defaultNow();
export const appSettings = pgTable("app_settings", {
  id: integer().primaryKey(),
  shopName: text("shop_name").notNull(),
  phone: text(),
  address: text(),
  receiptFooter: text("receipt_footer"),
  currency: text().notNull().default("MAD"),
  barcodePrefix: text("barcode_prefix").notNull().default("MKT"),
  nextBarcodeSequence: bigint("next_barcode_sequence", { mode: "number" })
    .notNull()
    .default(1),
  lowStockDefault: integer("low_stock_default").notNull().default(5),
  receiptWidth: integer("receipt_width").notNull().default(80),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const users = pgTable(
  "users",
  {
    id: serial().primaryKey(),
    fullName: text("full_name").notNull(),
    username: text().notNull(),
    email: text(),
    phone: text(),
    passwordHash: text("password_hash").notNull(),
    role: text().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("users_username_uq").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    index("users_active_idx").on(t.isActive),
    check(
      "users_role_ck",
      sql`${t.role} in ('global_admin','manager','cashier','stock_worker')`,
    ),
  ],
);
export const sessions = pgTable(
  "sessions",
  {
    id: serial().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: ts("created_at"),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_token_idx").on(t.tokenHash),
    index("sessions_expiry_idx").on(t.expiresAt),
  ],
);
export const categories = pgTable("categories", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  description: text(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const products = pgTable(
  "products",
  {
    id: serial().primaryKey(),
    categoryId: integer("category_id").references(() => categories.id),
    name: text().notNull(),
    description: text(),
    productType: text("product_type").notNull(),
    sku: text().unique(),
    manufacturerBarcode: text("manufacturer_barcode").unique(),
    internalBarcode: text("internal_barcode").notNull().unique(),
    qrIdentifier: text("qr_identifier").notNull().unique(),
    purchasePriceCents: bigint("purchase_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    sellingPriceCents: bigint("selling_price_cents", {
      mode: "number",
    }).notNull(),
    wholesalePriceCents: bigint("wholesale_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    wholesaleMinQuantity: integer("wholesale_min_quantity")
      .notNull()
      .default(1),
    currentStock: integer("current_stock").notNull().default(0),
    minimumStock: integer("minimum_stock").notNull().default(0),
    unit: text().notNull().default("unité"),
    shelfLocation: text("shelf_location"),
    isActive: boolean("is_active").notNull().default(true),
    trackStock: boolean("track_stock").notNull().default(true),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("products_name_idx").on(t.name),
    check("product_stock_ck", sql`${t.currentStock}>=0`),
    check(
      "product_prices_ck",
      sql`${t.purchasePriceCents}>=0 and ${t.sellingPriceCents}>=0`,
    ),
  ],
);
export const productPriceHistory = pgTable("product_price_history", {
  id: serial().primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  priceType: text("price_type").notNull(),
  oldValueCents: bigint("old_value_cents", { mode: "number" }).notNull(),
  newValueCents: bigint("new_value_cents", { mode: "number" }).notNull(),
  reason: text(),
  changedBy: integer("changed_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
});
export const customers = pgTable("customers", {
  id: serial().primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text(),
  email: text(),
  address: text(),
  notes: text(),
  creditLimitCents: bigint("credit_limit_cents", { mode: "number" })
    .notNull()
    .default(0),
  currentDebtCents: bigint("current_debt_cents", { mode: "number" })
    .notNull()
    .default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const suppliers = pgTable("suppliers", {
  id: serial().primaryKey(),
  name: text().notNull(),
  contactName: text("contact_name"),
  phone: text(),
  email: text(),
  address: text(),
  notes: text(),
  currentDebtCents: bigint("current_debt_cents", { mode: "number" })
    .notNull()
    .default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const registerSessions = pgTable(
  "cash_register_sessions",
  {
    id: serial().primaryKey(),
    cashierId: integer("cashier_id")
      .notNull()
      .references(() => users.id),
    openedAt: ts("opened_at"),
    openingAmountCents: bigint("opening_amount_cents", {
      mode: "number",
    }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    expectedClosingCents: bigint("expected_closing_cents", { mode: "number" }),
    actualClosingCents: bigint("actual_closing_cents", { mode: "number" }),
    differenceCents: bigint("difference_cents", { mode: "number" }),
    differenceReason: text("difference_reason"),
    status: text().notNull().default("open"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("one_open_register")
      .on(t.cashierId)
      .where(sql`${t.status}='open'`),
  ],
);
export const denominations = pgTable("cash_register_denominations", {
  id: serial().primaryKey(),
  cashRegisterSessionId: integer("cash_register_session_id")
    .notNull()
    .references(() => registerSessions.id),
  denominationCents: integer("denomination_cents").notNull(),
  quantity: integer().notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
});
export const sales = pgTable("sales", {
  id: serial().primaryKey(),
  saleNumber: text("sale_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customers.id),
  cashierId: integer("cashier_id")
    .notNull()
    .references(() => users.id),
  cashRegisterSessionId: integer("cash_register_session_id").references(
    () => registerSessions.id,
  ),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  cashPaidCents: bigint("cash_paid_cents", { mode: "number" }).notNull(),
  creditAmountCents: bigint("credit_amount_cents", {
    mode: "number",
  }).notNull(),
  changeCents: bigint("change_cents", { mode: "number" }).notNull(),
  paymentType: text("payment_type").notNull(),
  status: text().notNull(),
  notes: text(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const saleItems = pgTable("sale_items", {
  id: serial().primaryKey(),
  saleId: integer("sale_id")
    .notNull()
    .references(() => sales.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot"),
  barcodeSnapshot: text("barcode_snapshot"),
  productTypeSnapshot: text("product_type_snapshot").notNull(),
  quantity: integer().notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  purchasePriceSnapshotCents: bigint("purchase_price_snapshot_cents", {
    mode: "number",
  }).notNull(),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  returnedQuantity: integer("returned_quantity").notNull().default(0),
  createdAt: ts("created_at"),
});
export const stockMovements = pgTable("stock_movements", {
  id: serial().primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  movementType: text("movement_type").notNull(),
  quantityChange: integer("quantity_change").notNull(),
  stockBefore: integer("stock_before").notNull(),
  stockAfter: integer("stock_after").notNull(),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  reason: text().notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
});
export const purchases = pgTable("purchases", {
  id: serial().primaryKey(),
  purchaseNumber: text("purchase_number").notNull().unique(),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  cashRegisterSessionId: integer("cash_register_session_id").references(
    () => registerSessions.id,
  ),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  paidCents: bigint("paid_cents", { mode: "number" }).notNull(),
  remainingCents: bigint("remaining_cents", { mode: "number" }).notNull(),
  reference: text(),
  notes: text(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const purchaseItems = pgTable("purchase_items", {
  id: serial().primaryKey(),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer().notNull(),
  unitPurchasePriceCents: bigint("unit_purchase_price_cents", {
    mode: "number",
  }).notNull(),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  createdAt: ts("created_at"),
});
export const expenses = pgTable("expenses", {
  id: serial().primaryKey(),
  category: text().notNull(),
  description: text().notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  cashRegisterSessionId: integer("cash_register_session_id")
    .notNull()
    .references(() => registerSessions.id),
  expenseDate: timestamp("expense_date", { withTimezone: true }).notNull(),
  status: text().notNull(),
  correctionOfId: integer("correction_of_id"),
  notes: text(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});
export const returns = pgTable("returns", {
  id: serial().primaryKey(),
  returnNumber: text("return_number").notNull().unique(),
  originalSaleId: integer("original_sale_id")
    .notNull()
    .references(() => sales.id),
  customerId: integer("customer_id").references(() => customers.id),
  cashRegisterSessionId: integer("cash_register_session_id").references(
    () => registerSessions.id,
  ),
  totalReturnValueCents: bigint("total_return_value_cents", {
    mode: "number",
  }).notNull(),
  customerDebtReductionCents: bigint("customer_debt_reduction_cents", {
    mode: "number",
  }).notNull(),
  cashRefundCents: bigint("cash_refund_cents", { mode: "number" }).notNull(),
  reason: text().notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
});
export const returnItems = pgTable("return_items", {
  id: serial().primaryKey(),
  returnId: integer("return_id")
    .notNull()
    .references(() => returns.id),
  saleItemId: integer("sale_item_id")
    .notNull()
    .references(() => saleItems.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer().notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  condition: text(),
  restock: boolean().notNull(),
  createdAt: ts("created_at"),
});
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial().primaryKey(),
    userId: integer("user_id").references(() => users.id),
    action: text().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    oldValuesJson: text("old_values_json"),
    newValuesJson: text("new_values_json"),
    createdAt: ts("created_at"),
  },
  (t) => [index("audit_date_idx").on(t.createdAt)],
);
export const cashMovements = pgTable("cash_movements", {
  id: serial().primaryKey(),
  cashRegisterSessionId: integer("cash_register_session_id")
    .notNull()
    .references(() => registerSessions.id),
  movementType: text("movement_type").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  reason: text(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
});
export const customerCreditTransactions = pgTable(
  "customer_credit_transactions",
  {
    id: serial().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    saleId: integer("sale_id").references(() => sales.id),
    transactionType: text("transaction_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    balanceAfterCents: bigint("balance_after_cents", {
      mode: "number",
    }).notNull(),
    notes: text(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
  },
);
export const supplierPayments = pgTable("supplier_payments", {
  id: serial().primaryKey(),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  purchaseId: integer("purchase_id").references(() => purchases.id),
  cashRegisterSessionId: integer("cash_register_session_id")
    .notNull()
    .references(() => registerSessions.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  notes: text(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: ts("created_at"),
});
