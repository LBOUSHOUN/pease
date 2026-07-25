import { z } from "zod";
const requiredPassword = z.string().refine((value) => value.trim().length > 0, {
  message: "Le mot de passe est requis.",
});
export const ownerSchema = z.object({
  shopName: z.string().trim().min(1),
  fullName: z.string().trim().min(2),
  username: z
    .string()
    .trim()
    .min(3)
    .transform((x) => x.toLowerCase()),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  password: requiredPassword,
  barcodePrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,8}$/),
});
export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1)
    .transform((x) => x.toLowerCase()),
  password: z.string().min(1),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, "Le nouveau mot de passe doit contenir au moins 8 caractères.")
    .max(200)
    .regex(/[A-Za-zÀ-ÿ]/, "Le mot de passe doit contenir une lettre.")
    .regex(/[0-9]/, "Le mot de passe doit contenir un chiffre."),
  confirmation: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.newPassword !== value.confirmation)
    ctx.addIssue({
      code: "custom",
      path: ["confirmation"],
      message: "La confirmation ne correspond pas au nouveau mot de passe.",
    });
});
export const accountProfileUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[+0-9 ().-]*$/, "Numéro de téléphone invalide.")
      .nullable(),
    email: z.string().trim().toLowerCase().email().max(200).nullable(),
    currentPassword: z.string().max(200).optional(),
  })
  .strict();
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const dateRangeSchema = z
  .object({ start: z.string().date(), end: z.string().date() })
  .refine((x) => x.end >= x.start, {
    message: "La date de fin doit suivre la date de début",
  });
const optionalText = z.string().trim().max(5000).optional().nullable();
const optionalCode = z
  .string()
  .trim()
  .max(100)
  .optional()
  .nullable()
  .transform((v) => v || null);
export const barcodeValueSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), {
    message: "Le code-barres contient des caractères non imprimables.",
  });
const queryBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText,
});
export const categoryUpdateSchema = categoryCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const categoryFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(120).default(""),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  sort: z.enum(["name", "createdAt", "updatedAt"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
const isbn10Schema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{9}[0-9X]$/)
  .refine(
    (value) =>
      [...value].reduce(
        (sum, character, index) =>
          sum +
          (character === "X" ? 10 : Number(character)) * (10 - index),
        0,
      ) %
        11 ===
      0,
    "ISBN-10 invalide.",
  );
const isbn13Schema = z
  .string()
  .trim()
  .regex(/^97[89][0-9]{10}$/)
  .refine((value) => {
    const sum = [...value.slice(0, 12)].reduce(
      (total, character, index) =>
        total + Number(character) * (index % 2 === 0 ? 1 : 3),
      0,
    );
    return (10 - (sum % 10)) % 10 === Number(value[12]);
  }, "ISBN-13 invalide.");
const productBase = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  author: z.string().trim().max(300).optional().nullable(),
  isbn10: isbn10Schema.optional().nullable(),
  isbn13: isbn13Schema.optional().nullable(),
  publisher: z.string().trim().max(200).optional().nullable(),
  publicationYear: z.number().int().min(1000).max(2200).optional().nullable(),
  bookLanguage: z.string().trim().max(40).optional().nullable(),
  coverImageUrl: z.string().trim().url().max(1000).refine((value) => value.startsWith("https://"), "L’image doit utiliser HTTPS.").optional().nullable(),
  productType: z.enum(["physical_product", "service"]),
  inventoryMode: z.enum(["quantity", "serialized"]).default("quantity"),
  sku: optionalCode,
  manufacturerBarcode: optionalCode,
  purchasePriceCents: z.number().int().min(0),
  sellingPriceCents: z.number().int().min(0),
  wholesalePriceCents: z.number().int().min(0).default(0),
  wholesaleMinQuantity: z.number().int().min(0).default(1),
  minimumStock: z.number().int().min(0).default(0),
  unit: z.string().trim().min(1).max(40).default("unité"),
  shelfLocation: optionalCode,
  trackStock: z.boolean().default(true),
});
export const productCreateSchema = productBase
  .extend({ initialQuantity: z.number().int().min(0).max(100000).default(0) })
  .superRefine((value, ctx) => {
    if (value.inventoryMode === "serialized" && value.initialQuantity > 0)
      ctx.addIssue({ code: "custom", path: ["initialQuantity"], message: "Utilisez la réception par unité pour le stock sérialisé" });
  })
  .transform((v) =>
    v.productType === "service"
      ? { ...v, inventoryMode: "quantity" as const, trackStock: false, minimumStock: 0, initialQuantity: 0 }
      : v,
  );
export const productUpdateSchema = productBase
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const bookDuplicateQuerySchema = z.object({
  isbn10: isbn10Schema.optional(),
  isbn13: isbn13Schema.optional(),
  title: z.string().trim().max(200).default(""),
  author: z.string().trim().max(300).default(""),
}).refine((value) => value.isbn10 || value.isbn13 || value.title, {
  message: "Un ISBN ou un titre est requis.",
});

export const serializedReceivingCreateSchema = z.object({
  productId: z.number().int().positive(),
  supplierId: z.number().int().positive().optional().nullable(),
  expectedQuantity: z.number().int().positive().max(1000),
});
export const serializedReceivingQuantitySchema = z.object({
  expectedQuantity: z.number().int().positive().max(1000),
});
export const serializedReceivingScanSchema = z.object({
  barcode: barcodeValueSchema,
});
export const serializedReceivingBatchSchema = z.object({
  barcodes: z.array(barcodeValueSchema).min(1).max(1000),
});
export const productFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  categoryId: z.coerce.number().int().positive().optional(),
  productType: z.enum(["physical_product", "service"]).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  lowStockOnly: queryBoolean.default(false),
  outOfStockOnly: queryBoolean.default(false),
  sort: z
    .enum(["name", "createdAt", "sellingPriceCents", "currentStock"])
    .default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export const identifierLookupSchema = z.object({
  code: z.string().trim().min(2).max(200),
  saleReady: queryBoolean.default(false),
});
export const stockAdjustmentSchema = z
  .object({
    productId: z.number().int().positive(),
    movementType: z.enum([
      "opening_stock",
      "stock_in",
      "stock_out",
      "damaged",
      "lost",
      "manual_adjustment",
      "inventory_adjustment",
    ]),
    quantity: z.number().int().positive(),
    direction: z.enum(["increase", "decrease"]).optional(),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      ["manual_adjustment", "inventory_adjustment"].includes(v.movementType) &&
      !v.direction
    )
      ctx.addIssue({
        code: "custom",
        message: "La direction est obligatoire",
        path: ["direction"],
      });
  });
export const quickStockReceiptSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(100000),
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/),
});
export const stockFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  lowStockOnly: queryBoolean.default(false),
  outOfStockOnly: queryBoolean.default(false),
});
export const stockMovementFiltersSchema = paginationSchema.extend({
  productId: z.coerce.number().int().positive().optional(),
  movementType: z
    .enum([
      "opening_stock",
      "stock_in",
      "stock_out",
      "damaged",
      "lost",
      "manual_adjustment",
      "inventory_adjustment",
    ])
    .optional(),
  workerId: z.coerce.number().int().positive().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const denominationSchema = z.object({
  denominationCents: z.number().int(),
  quantity: z.number().int().min(0),
});
export const denominationValues = [
  20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;
const denominations = z
  .array(denominationSchema)
  .max(9)
  .superRefine((lines, ctx) => {
    const seen = new Set<number>();
    for (const [i, line] of lines.entries()) {
      if (
        !denominationValues.includes(
          line.denominationCents as (typeof denominationValues)[number],
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Coupure invalide",
          path: [i, "denominationCents"],
        });
      if (seen.has(line.denominationCents))
        ctx.addIssue({
          code: "custom",
          message: "Coupure dupliquée",
          path: [i],
        });
      seen.add(line.denominationCents);
    }
  });
export const registerOpenSchema = z.object({
  openingCashCents: z.number().int().min(0),
  denominations: denominations.optional(),
  note: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const registerCloseSchema = z.object({
  actualCashCents: z.number().int().min(0),
  denominations,
  differenceReason: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
const nullableContact = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => v || null);
export const customerCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: nullableContact,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => v || null),
  address: nullableContact,
  notes: optionalText,
  creditLimitCents: z.number().int().min(0).default(0),
});
export const customerUpdateSchema = customerCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const customerFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  debtOnly: queryBoolean.default(false),
  sort: z.enum(["name", "createdAt", "currentDebtCents"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export const debtPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  note: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const priceAdjustmentTypes = [
  "final_unit_price",
  "fixed_discount",
  "percentage_discount",
  "fixed_markup",
  "percentage_markup",
] as const;
export type PriceAdjustmentType = (typeof priceAdjustmentTypes)[number];

export function calculateAdjustedUnitPrice(
  baseUnitPriceCents: number,
  type: PriceAdjustmentType,
  value: number,
) {
  if (!Number.isSafeInteger(baseUnitPriceCents) || baseUnitPriceCents < 0)
    throw new Error("BASE_PRICE");
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000)
    throw new Error("ADJUSTMENT_VALUE");
  if (type === "percentage_discount" && value >= 10000)
    throw new Error("ADJUSTMENT_VALUE");
  if (type.includes("percentage") && value > 1_000_000)
    throw new Error("ADJUSTMENT_VALUE");
  let result: number;
  if (type === "final_unit_price") result = value;
  else if (type === "fixed_discount") result = baseUnitPriceCents - value;
  else if (type === "fixed_markup") result = baseUnitPriceCents + value;
  else if (type === "percentage_discount")
    result = Math.round((baseUnitPriceCents * (10000 - value)) / 10000);
  else result = Math.round((baseUnitPriceCents * (10000 + value)) / 10000);
  if (!Number.isSafeInteger(result)) throw new Error("ADJUSTMENT_VALUE");
  return result;
}

export const saleCartLineSchema = z
  .object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(100000),
    unitBarcodes: z.array(barcodeValueSchema).max(1000).optional(),
    serializedUnits: z
      .array(
        z.object({
          id: z.number().int().positive(),
          barcode: barcodeValueSchema,
        }),
      )
      .max(1000)
      .optional(),
    finalUnitPriceCents: z.number().int().positive().optional(),
    priceAdjustmentType: z.enum(priceAdjustmentTypes).optional(),
    priceAdjustmentValue: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .optional(),
    priceAdjustmentReason: z.string().trim().min(3).max(300).optional(),
  })
  .superRefine((line, ctx) => {
    const fields = [
      line.finalUnitPriceCents,
      line.priceAdjustmentType,
      line.priceAdjustmentValue,
      line.priceAdjustmentReason,
    ];
    const hasAny = fields.some((value) => value !== undefined);
    const hasAll = fields.every((value) => value !== undefined);
    if (hasAny && !hasAll)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Les informations de modification du prix sont incomplètes.",
      });
    if (
      line.priceAdjustmentType === "percentage_discount" &&
      line.priceAdjustmentValue !== undefined &&
      line.priceAdjustmentValue >= 10000
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La remise en pourcentage doit être inférieure à 100 %.",
        path: ["priceAdjustmentValue"],
      });
    if (
      line.priceAdjustmentType?.includes("percentage") &&
      line.priceAdjustmentValue !== undefined &&
      line.priceAdjustmentValue > 1_000_000
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Le pourcentage saisi est trop élevé.",
        path: ["priceAdjustmentValue"],
      });
  });
export const saleCreateSchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  items: z.array(saleCartLineSchema).min(1).max(200),
  paymentMode: z.enum(["cash", "credit", "partial"]),
  cashPaidCents: z.number().int().min(0).default(0),
  idempotencyKey: idempotencyKeySchema,
  note: z.string().trim().max(1000).optional().nullable(),
});
export const salesFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  customerId: z.coerce.number().int().positive().optional(),
  workerId: z.coerce.number().int().positive().optional(),
  paymentMode: z.enum(["cash", "credit", "partial"]).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  minAmountCents: z.coerce.number().int().min(0).optional(),
  maxAmountCents: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["createdAt", "totalCents", "saleNumber"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export const registerListFiltersSchema = paginationSchema.extend({
  status: z.enum(["all", "open", "closed"]).default("all"),
});
export const registerMovementFiltersSchema = paginationSchema.extend({
  sessionId: z.coerce.number().int().positive().optional(),
  movementType: z.string().trim().max(50).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export const supplierCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: nullableContact,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => v || null),
  address: nullableContact,
  notes: optionalText,
});
export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const supplierFiltersSchema = customerFiltersSchema;
export const supplierPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  paymentSource: z.enum(["cash_register", "external_cash"]),
  note: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const purchaseItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(100000),
  purchaseUnitPriceCents: z.number().int().min(0),
});
export const purchaseCreateSchema = z.object({
  supplierId: z.number().int().positive(),
  items: z.array(purchaseItemSchema).min(1).max(200),
  paymentMode: z.enum(["cash", "credit", "partial"]),
  cashPaidCents: z.number().int().min(0).default(0),
  paymentSource: z.enum(["cash_register", "external_cash"]),
  invoiceNumber: z.string().trim().max(100).optional().nullable(),
  invoiceDate: z.string().date().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const purchaseFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  supplierId: z.coerce.number().int().positive().optional(),
  paymentMode: z.enum(["cash", "credit", "partial"]).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export const expenseCreateSchema = z.object({
  category: z.string().trim().min(2).max(100),
  description: z.string().trim().min(3).max(500),
  amountCents: z.number().int().positive(),
  paymentSource: z.enum(["cash_register", "external_cash"]),
  expenseDate: z.string().date(),
  note: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export const expenseCorrectionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: idempotencyKeySchema,
});
export const expenseFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  category: z.string().trim().max(100).optional(),
  paymentSource: z.enum(["cash_register", "external_cash"]).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export const returnItemSchema = z.object({
  saleItemId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  restock: z.boolean(),
  condition: z.string().trim().max(200).optional().nullable(),
  unitBarcodes: z.array(barcodeValueSchema).max(1000).optional(),
});
export const returnCreateSchema = z.object({
  saleId: z.number().int().positive(),
  items: z.array(returnItemSchema).min(1).max(200),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: idempotencyKeySchema,
});
export const returnFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(200).default(""),
  saleId: z.coerce.number().int().positive().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});

const roleSchema = z.enum([
  "global_admin",
  "manager",
  "cashier",
  "stock_worker",
]);
export const userFiltersSchema = paginationSchema.extend({
  search: z.string().trim().max(100).default(""),
  role: z.union([roleSchema, z.literal("all")]).default("all"),
  status: z.enum(["all", "active", "inactive"]).default("all"),
});
export const userCreateSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  role: roleSchema,
  password: requiredPassword,
});
export const userUpdateSchema = userCreateSchema.omit({ password: true }).partial();
export const passwordResetSchema = z.object({ confirmation: z.literal(true), password: requiredPassword });
export const forcePasswordChangeSchema = z.object({ required: z.boolean() });
export const auditFiltersSchema = paginationSchema.extend({
  userId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(100).default(""),
  entityType: z.string().trim().max(100).default(""),
  entityId: z.coerce.number().int().positive().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().trim().max(100).default(""),
});
export const reportFiltersSchema = paginationSchema.extend({
  preset: z
    .enum([
      "today",
      "yesterday",
      "this_week",
      "this_month",
      "last_month",
      "custom",
    ])
    .default("today"),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().trim().max(100).default(""),
  paymentMode: z.enum(["cash", "credit", "partial"]).optional(),
  userId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(["all", "active", "inactive", "low", "out"]).default("all"),
  category: z.string().trim().max(100).optional(),
  paymentSource: z.enum(["cash_register", "external_cash"]).optional(),
});
export const topProductsFiltersSchema = z
  .object({
    period: z.enum(["today", "7d", "30d", "month", "custom"]).default("30d"),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((value, ctx) => {
    if (value.period === "custom" && (!value.startDate || !value.endDate))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Une date de début et une date de fin sont requises.",
      });
  });

export const settingsUpdateSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullable(),
  address: z.string().trim().max(300).nullable(),
  receiptFooter: z.string().trim().max(300).nullable(),
  currency: z.literal("MAD"),
  timezone: z.string().trim().min(1).max(80),
  barcodePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/),
  lowStockDefault: z.number().int().min(0).max(100000),
  receiptWidth: z.union([z.literal(58), z.literal(80)]),
  showBarcodeOnReceipt: z.boolean(),
  showQrOnLabel: z.boolean(),
  showPriceOnLabel: z.boolean(),
  labelSize: z.enum(["40x30", "50x30", "A4"]),
  backupRetention: z.number().int().min(1).max(365).optional(),
  sessionTimeoutMinutes: z.number().int().min(15).max(10080),
});
export const backupRestoreSchema = z.object({
  confirmation: z.literal("RESTORE"),
});
