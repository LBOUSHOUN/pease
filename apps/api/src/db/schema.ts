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
  nextSaleSequence: bigint("next_sale_sequence", { mode: "number" })
    .notNull()
    .default(1),
  nextPurchaseSequence: bigint("next_purchase_sequence", { mode: "number" })
    .notNull()
    .default(1),
  nextReturnSequence: bigint("next_return_sequence", { mode: "number" })
    .notNull()
    .default(1),
  lowStockDefault: integer("low_stock_default").notNull().default(5),
  receiptWidth: integer("receipt_width").notNull().default(80),
  timezone: text().notNull().default("Africa/Casablanca"),
  showBarcodeOnReceipt: boolean("show_barcode_on_receipt")
    .notNull()
    .default(true),
  showQrOnLabel: boolean("show_qr_on_label").notNull().default(true),
  showPriceOnLabel: boolean("show_price_on_label").notNull().default(true),
  labelSize: text("label_size").notNull().default("40x30"),
  backupRetention: integer("backup_retention").notNull().default(7),
  sessionTimeoutMinutes: integer("session_timeout_minutes")
    .notNull()
    .default(720),
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
    index("users_name_idx").on(t.fullName),
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
    sessionType: text("session_type").notNull().default("browser"),
    deviceLabel: text("device_label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: ts("created_at"),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_token_idx").on(t.tokenHash),
    index("sessions_expiry_idx").on(t.expiresAt),
    check("sessions_type_ck", sql`${t.sessionType} in ('browser','desktop')`),
  ],
);
export const categories = pgTable(
  "categories",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    description: text(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("categories_name_normalized_uq").on(
      sql`lower(trim(${t.name}))`,
    ),
    index("categories_active_idx").on(t.isActive),
  ],
);
export const products = pgTable(
  "products",
  {
    id: serial().primaryKey(),
    categoryId: integer("category_id").references(() => categories.id),
    name: text().notNull(),
    description: text(),
    author: text(),
    isbn10: text(),
    isbn13: text(),
    publisher: text(),
    publicationYear: integer("publication_year"),
    bookLanguage: text("book_language"),
    coverImageUrl: text("cover_image_url"),
    productType: text("product_type").notNull(),
    inventoryMode: text("inventory_mode").notNull().default("quantity"),
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: integer("archived_by").references(() => users.id),
    trackStock: boolean("track_stock").notNull().default(true),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("products_name_idx").on(t.name),
    index("products_category_idx").on(t.categoryId),
    index("products_active_type_idx").on(t.isActive, t.productType),
    index("products_sku_idx").on(t.sku),
    index("products_manufacturer_barcode_idx").on(t.manufacturerBarcode),
    index("products_internal_barcode_idx").on(t.internalBarcode),
    index("products_qr_identifier_idx").on(t.qrIdentifier),
    uniqueIndex("products_isbn10_uq")
      .on(sql`lower(trim(${t.isbn10}))`)
      .where(sql`${t.isbn10} is not null`),
    uniqueIndex("products_isbn13_uq")
      .on(sql`lower(trim(${t.isbn13}))`)
      .where(sql`${t.isbn13} is not null`),
    check(
      "products_publication_year_ck",
      sql`${t.publicationYear} is null or (${t.publicationYear}>=1000 and ${t.publicationYear}<=2200)`,
    ),
    check("product_stock_ck", sql`${t.currentStock}>=0`),
    check(
      "product_prices_ck",
      sql`${t.purchasePriceCents}>=0 and ${t.sellingPriceCents}>=0`,
    ),
    check(
      "product_other_values_ck",
      sql`${t.wholesalePriceCents}>=0 and ${t.wholesaleMinQuantity}>=0 and ${t.minimumStock}>=0`,
    ),
    check(
      "product_type_ck",
      sql`${t.productType} in ('physical_product','service')`,
    ),
    check("product_inventory_mode_ck", sql`${t.inventoryMode} in ('quantity','serialized')`),
    check("service_inventory_mode_ck", sql`${t.productType}<>'service' or ${t.inventoryMode}='quantity'`),
    check(
      "service_stock_ck",
      sql`${t.productType}<>'service' or (${t.trackStock}=false and ${t.currentStock}=0)`,
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
export const customers = pgTable(
  "customers",
  {
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
    createdBy: integer("created_by").references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("customers_name_idx").on(t.fullName),
    index("customers_active_debt_idx").on(t.isActive, t.currentDebtCents),
    check(
      "customers_money_ck",
      sql`${t.creditLimitCents}>=0 and ${t.currentDebtCents}>=0`,
    ),
  ],
);
export const suppliers = pgTable(
  "suppliers",
  {
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
    createdBy: integer("created_by").references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("suppliers_name_idx").on(t.name),
    index("suppliers_active_debt_idx").on(t.isActive, t.currentDebtCents),
    check("suppliers_debt_ck", sql`${t.currentDebtCents}>=0`),
  ],
);
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
    closedById: integer("closed_by").references(() => users.id),
    expectedClosingCents: bigint("expected_closing_cents", { mode: "number" }),
    actualClosingCents: bigint("actual_closing_cents", { mode: "number" }),
    differenceCents: bigint("difference_cents", { mode: "number" }),
    differenceReason: text("difference_reason"),
    openingNote: text("opening_note"),
    closingNote: text("closing_note"),
    openingIdempotencyKey: text("opening_idempotency_key"),
    closingIdempotencyKey: text("closing_idempotency_key"),
    status: text().notNull().default("open"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("one_open_register")
      .on(sql`(1)`)
      .where(sql`${t.status}='open'`),
    uniqueIndex("register_open_idempotency_uq")
      .on(t.cashierId, t.openingIdempotencyKey)
      .where(sql`${t.openingIdempotencyKey} is not null`),
    uniqueIndex("register_close_idempotency_uq")
      .on(t.cashierId, t.closingIdempotencyKey)
      .where(sql`${t.closingIdempotencyKey} is not null`),
    index("register_cashier_date_idx").on(t.cashierId, t.openedAt),
    check(
      "register_money_ck",
      sql`${t.openingAmountCents}>=0 and (${t.actualClosingCents} is null or ${t.actualClosingCents}>=0)`,
    ),
    check("register_status_ck", sql`${t.status} in ('open','closed')`),
  ],
);
export const denominations = pgTable(
  "cash_register_denominations",
  {
    id: serial().primaryKey(),
    cashRegisterSessionId: integer("cash_register_session_id")
      .notNull()
      .references(() => registerSessions.id),
    denominationCents: integer("denomination_cents").notNull(),
    quantity: integer().notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    phase: text().notNull().default("closing"),
  },
  (t) => [
    check(
      "denomination_values_ck",
      sql`${t.denominationCents} in (20000,10000,5000,2000,1000,500,200,100,50)`,
    ),
    check(
      "denomination_quantity_ck",
      sql`${t.quantity}>=0 and ${t.totalCents}=${t.denominationCents}*${t.quantity}`,
    ),
    check("denomination_phase_ck", sql`${t.phase} in ('opening','closing')`),
    uniqueIndex("denomination_session_phase_value_uq").on(
      t.cashRegisterSessionId,
      t.phase,
      t.denominationCents,
    ),
  ],
);
export const sales = pgTable(
  "sales",
  {
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
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("sales_cashier_idempotency_uq").on(
      t.cashierId,
      t.idempotencyKey,
    ),
    index("sales_date_idx").on(t.createdAt),
    index("sales_customer_date_idx").on(t.customerId, t.createdAt),
    index("sales_cashier_date_idx").on(t.cashierId, t.createdAt),
    check(
      "sales_money_ck",
      sql`${t.subtotalCents}>=0 and ${t.discountCents}>=0 and ${t.totalCents}>=0 and ${t.cashPaidCents}>=0 and ${t.creditAmountCents}>=0 and ${t.changeCents}>=0 and ${t.cashPaidCents}+${t.creditAmountCents}=${t.totalCents}`,
    ),
    check(
      "sales_payment_ck",
      sql`${t.paymentType} in ('cash','credit','partial')`,
    ),
  ],
);
export const saleItems = pgTable(
  "sale_items",
  {
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
    baseUnitPriceCents: bigint("base_unit_price_cents", { mode: "number" }).notNull(),
    purchasePriceSnapshotCents: bigint("purchase_price_snapshot_cents", {
      mode: "number",
    }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
    priceAdjustmentType: text("price_adjustment_type"),
    priceAdjustmentValue: integer("price_adjustment_value"),
    priceAdjustmentReason: text("price_adjustment_reason"),
    priceAdjustedBy: integer("price_adjusted_by").references(() => users.id),
    priceAdjustedAt: timestamp("price_adjusted_at", { withTimezone: true }),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_product_idx").on(t.productId),
  ],
);
export const stockMovements = pgTable(
  "stock_movements",
  {
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
    idempotencyKey: text("idempotency_key"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("stock_movements_product_date_idx").on(t.productId, t.createdAt),
    index("stock_movements_worker_date_idx").on(t.createdBy, t.createdAt),
    index("stock_movements_type_date_idx").on(t.movementType, t.createdAt),
    index("stock_movements_reference_idx").on(t.referenceType, t.referenceId),
    uniqueIndex("stock_movements_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);
export const purchases = pgTable(
  "purchases",
  {
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
    paymentMode: text("payment_mode").notNull().default("credit"),
    paymentSource: text("payment_source").notNull().default("external_cash"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: timestamp("invoice_date", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    reference: text(),
    notes: text(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("purchases_worker_idempotency_uq")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("purchases_supplier_date_idx").on(t.supplierId, t.createdAt),
    index("purchases_date_idx").on(t.createdAt),
    check(
      "purchases_money_ck",
      sql`${t.subtotalCents}>=0 and ${t.totalCents}>=0 and ${t.paidCents}>=0 and ${t.remainingCents}>=0 and ${t.paidCents}+${t.remainingCents}=${t.totalCents}`,
    ),
  ],
);
export const purchaseItems = pgTable(
  "purchase_items",
  {
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
  },
  (t) => [
    index("purchase_items_purchase_idx").on(t.purchaseId),
    index("purchase_items_product_idx").on(t.productId),
    check(
      "purchase_items_values_ck",
      sql`${t.quantity}>0 and ${t.unitPurchasePriceCents}>=0 and ${t.lineTotalCents}>=0`,
    ),
  ],
);
export const expenses = pgTable(
  "expenses",
  {
    id: serial().primaryKey(),
    category: text().notNull(),
    description: text().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    cashRegisterSessionId: integer("cash_register_session_id").references(
      () => registerSessions.id,
    ),
    paymentSource: text("payment_source").notNull().default("cash_register"),
    expenseDate: timestamp("expense_date", { withTimezone: true }).notNull(),
    status: text().notNull(),
    correctionOfId: integer("correction_of_id"),
    correctionReason: text("correction_reason"),
    idempotencyKey: text("idempotency_key"),
    notes: text(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("expenses_worker_idempotency_uq")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("expenses_correction_uq")
      .on(t.correctionOfId)
      .where(sql`${t.correctionOfId} is not null`),
    index("expenses_date_idx").on(t.expenseDate),
    index("expenses_category_date_idx").on(t.category, t.expenseDate),
    check("expenses_amount_ck", sql`${t.amountCents}<>0`),
  ],
);
export const returns = pgTable(
  "returns",
  {
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
    idempotencyKey: text("idempotency_key"),
    status: text().notNull().default("completed"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
  },
  (t) => [
    uniqueIndex("returns_worker_idempotency_uq")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("returns_sale_date_idx").on(t.originalSaleId, t.createdAt),
    index("returns_date_idx").on(t.createdAt),
    check(
      "returns_money_ck",
      sql`${t.totalReturnValueCents}>0 and ${t.customerDebtReductionCents}>=0 and ${t.cashRefundCents}>=0 and ${t.customerDebtReductionCents}+${t.cashRefundCents}=${t.totalReturnValueCents}`,
    ),
  ],
);
export const returnItems = pgTable(
  "return_items",
  {
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
  },
  (t) => [
    index("return_items_return_idx").on(t.returnId),
    index("return_items_sale_item_idx").on(t.saleItemId),
    check(
      "return_items_values_ck",
      sql`${t.quantity}>0 and ${t.amountCents}>=0`,
    ),
  ],
);
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
  (t) => [
    index("audit_date_idx").on(t.createdAt),
    index("audit_user_date_idx").on(t.userId, t.createdAt),
    index("audit_action_date_idx").on(t.action, t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);
export const backups = pgTable(
  "backups",
  {
    id: serial().primaryKey(),
    filename: text().notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    checksumSha256: text("checksum_sha256"),
    status: text().notNull().default("creating"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("backups_created_idx").on(t.createdAt),
    check(
      "backups_status_ck",
      sql`${t.status} in ('creating','ready','verified','failed','restoring')`,
    ),
    check("backups_size_ck", sql`${t.sizeBytes}>=0`),
  ],
);
export const cashMovements = pgTable(
  "cash_movements",
  {
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
  },
  (t) => [
    index("cash_movements_register_date_idx").on(
      t.cashRegisterSessionId,
      t.createdAt,
    ),
    index("cash_movements_reference_idx").on(t.referenceType, t.referenceId),
  ],
);
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
    balanceBeforeCents: bigint("balance_before_cents", { mode: "number" }),
    balanceAfterCents: bigint("balance_after_cents", {
      mode: "number",
    }).notNull(),
    notes: text(),
    cashRegisterSessionId: integer("cash_register_session_id").references(
      () => registerSessions.id,
    ),
    idempotencyKey: text("idempotency_key"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("customer_credit_customer_date_idx").on(t.customerId, t.createdAt),
    uniqueIndex("customer_credit_worker_idempotency_uq")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check(
      "customer_credit_balance_ck",
      sql`${t.balanceAfterCents}>=0 and (${t.balanceBeforeCents} is null or ${t.balanceBeforeCents}>=0)`,
    ),
  ],
);
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: serial().primaryKey(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    purchaseId: integer("purchase_id").references(() => purchases.id),
    cashRegisterSessionId: integer("cash_register_session_id").references(
      () => registerSessions.id,
    ),
    transactionType: text("transaction_type")
      .notNull()
      .default("supplier_payment"),
    paymentSource: text("payment_source"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    balanceBeforeCents: bigint("balance_before_cents", { mode: "number" })
      .notNull()
      .default(0),
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" })
      .notNull()
      .default(0),
    idempotencyKey: text("idempotency_key"),
    notes: text(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("supplier_ledger_supplier_date_idx").on(t.supplierId, t.createdAt),
    uniqueIndex("supplier_ledger_worker_idempotency_uq")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check(
      "supplier_ledger_balance_ck",
      sql`${t.balanceBeforeCents}>=0 and ${t.balanceAfterCents}>=0`,
    ),
  ],
);

export const serializedReceivingSessions = pgTable(
  "serialized_receiving_sessions",
  {
    id: serial().primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    purchaseId: integer("purchase_id").references(() => purchases.id),
    expectedQuantity: integer("expected_quantity").notNull(),
    status: text().notNull().default("draft"),
    createdBy: integer("created_by").notNull().references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("serialized_receiving_product_status_idx").on(t.productId, t.status),
    index("serialized_receiving_creator_date_idx").on(t.createdBy, t.createdAt),
    check("serialized_receiving_quantity_ck", sql`${t.expectedQuantity}>0 and ${t.expectedQuantity}<=1000`),
    check("serialized_receiving_status_ck", sql`${t.status} in ('draft','completed','cancelled')`),
  ],
);

export const productUnits = pgTable(
  "product_units",
  {
    id: serial().primaryKey(),
    productId: integer("product_id").notNull().references(() => products.id),
    barcode: text().notNull(),
    status: text().notNull().default("available"),
    receivingSessionId: integer("receiving_session_id").references(() => serializedReceivingSessions.id),
    purchaseId: integer("purchase_id").references(() => purchases.id),
    purchaseItemId: integer("purchase_item_id").references(() => purchaseItems.id),
    saleId: integer("sale_id").references(() => sales.id),
    saleItemId: integer("sale_item_id").references(() => saleItems.id),
    returnId: integer("return_id").references(() => returns.id),
    returnItemId: integer("return_item_id").references(() => returnItems.id),
    returnCondition: text("return_condition"),
    receivedAt: ts("received_at"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("product_units_barcode_normalized_uq").on(sql`lower(trim(${t.barcode}))`),
    index("product_units_barcode_idx").on(t.barcode),
    index("product_units_product_status_idx").on(t.productId, t.status),
    index("product_units_sale_idx").on(t.saleId, t.saleItemId),
    check("product_units_barcode_ck", sql`length(trim(${t.barcode})) between 2 and 100`),
    check("product_units_status_ck", sql`${t.status} in ('available','sold','damaged','lost','inactive')`),
  ],
);

export const serializedReceivingScans = pgTable(
  "serialized_receiving_scans",
  {
    id: serial().primaryKey(),
    sessionId: integer("session_id").notNull().references(() => serializedReceivingSessions.id, { onDelete: "cascade" }),
    barcode: text().notNull(),
    createdAt: ts("created_at"),
  },
  (t) => [
    uniqueIndex("serialized_receiving_scan_session_barcode_uq").on(t.sessionId, sql`lower(trim(${t.barcode}))`),
    index("serialized_receiving_scan_session_idx").on(t.sessionId, t.createdAt),
    check("serialized_receiving_scan_barcode_ck", sql`length(trim(${t.barcode})) between 2 and 100`),
  ],
);
