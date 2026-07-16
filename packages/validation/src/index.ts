import { z } from "zod";
const strong = z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
export const ownerSchema = z.object({
  shopName: z.string().trim().min(1),
  fullName: z.string().trim().min(2),
  username: z
    .string()
    .trim()
    .min(3)
    .transform((x) => x.toLowerCase()),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  password: strong,
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
  newPassword: strong,
});
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
const productBase = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  productType: z.enum(["physical_product", "service"]),
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
export const productCreateSchema = productBase.transform((v) =>
  v.productType === "service"
    ? { ...v, trackStock: false, minimumStock: 0 }
    : v,
);
export const productUpdateSchema = productBase
  .partial()
  .refine((v) => Object.keys(v).length > 0);
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
