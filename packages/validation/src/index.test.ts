import { describe, expect, it } from "vitest";
import {
  calculateAdjustedUnitPrice,
  loginSchema,
  ownerSchema,
  productCreateSchema,
  quickStockReceiptSchema,
  saleCreateSchema,
  topProductsFiltersSchema,
} from "./index";
describe("online validation", () => {
  const owner = (password: string) =>
    ownerSchema.safeParse({
        shopName: "M",
        fullName: "Owner",
        username: "owner",
        email: "",
        password,
        barcodePrefix: "MKT",
      });
  it.each(["1", "0", "a", "12", "test"])(
    "accepts the non-empty password %s",
    (password) => expect(owner(password).success).toBe(true),
  );
  it.each(["", "   ", "\t"])("rejects an empty password", (password) =>
    expect(owner(password).success).toBe(false),
  );
  it("calculates fixed and percentage price changes in integer centimes", () => {
    expect(calculateAdjustedUnitPrice(1000, "fixed_discount", 150)).toBe(850);
    expect(calculateAdjustedUnitPrice(1000, "fixed_markup", 150)).toBe(1150);
    expect(calculateAdjustedUnitPrice(1000, "percentage_discount", 1250)).toBe(875);
    expect(calculateAdjustedUnitPrice(1000, "percentage_markup", 1250)).toBe(1125);
    expect(calculateAdjustedUnitPrice(0, "final_unit_price", 500)).toBe(500);
    expect(() =>
      calculateAdjustedUnitPrice(1000, "percentage_discount", 10000),
    ).toThrow("ADJUSTMENT_VALUE");
  });
  it("requires complete sale-line price adjustment metadata", () => {
    const base = {
      items: [{ productId: 1, quantity: 1 }],
      paymentMode: "cash" as const,
      cashPaidCents: 0,
      idempotencyKey: "sale-price-1",
    };
    expect(saleCreateSchema.safeParse(base).success).toBe(true);
    expect(
      saleCreateSchema.safeParse({
        ...base,
        items: [{ productId: 1, quantity: 1, finalUnitPriceCents: 900 }],
      }).success,
    ).toBe(false);
    expect(
      saleCreateSchema.safeParse({
        ...base,
        items: [
          {
            productId: 1,
            quantity: 1,
            finalUnitPriceCents: 900,
            priceAdjustmentType: "final_unit_price",
            priceAdjustmentValue: 900,
            priceAdjustmentReason: "Remise client",
          },
        ],
      }).success,
    ).toBe(true);
  });
  it("validates top-product date filters and limits", () => {
    expect(topProductsFiltersSchema.parse({}).period).toBe("30d");
    expect(
      topProductsFiltersSchema.safeParse({
        period: "custom",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        limit: 10,
      }).success,
    ).toBe(true);
    expect(
      topProductsFiltersSchema.safeParse({ period: "custom", limit: 51 })
        .success,
    ).toBe(false);
  });
  it("accepts credentials", () =>
    expect(
      loginSchema.safeParse({ login: "owner", password: "Secret123" }).success,
    ).toBe(true));
  it("accepts arbitrary positive stock receipts and rejects non-integers", () => {
    for (const quantity of [1, 5, 7, 24, 50])
      expect(quickStockReceiptSchema.safeParse({ productId: 1, quantity, idempotencyKey: `receipt-${quantity}` }).success).toBe(true);
    for (const quantity of [0, -1, 1.5])
      expect(quickStockReceiptSchema.safeParse({ productId: 1, quantity, idempotencyKey: "receipt-invalid" }).success).toBe(false);
  });
  it("allows initial quantity only for normal physical inventory", () => {
    const base = {
      categoryId: 1, name: "Cahier", description: "", productType: "physical_product" as const,
      inventoryMode: "quantity" as const, sku: "", manufacturerBarcode: "6110001",
      purchasePriceCents: 100, sellingPriceCents: 200, wholesalePriceCents: 0,
      wholesaleMinQuantity: 1, minimumStock: 0, unit: "unité", shelfLocation: "", trackStock: true,
    };
    expect(productCreateSchema.safeParse({ ...base, initialQuantity: 50 }).success).toBe(true);
    expect(
      productCreateSchema.safeParse({
        ...base,
        initialQuantity: 0,
        imageBase64: "data:image/jpeg;base64,secret",
      }).success,
    ).toBe(false);
    expect(productCreateSchema.safeParse({ ...base, inventoryMode: "serialized", initialQuantity: 1 }).success).toBe(false);
    const service = productCreateSchema.parse({ ...base, productType: "service", initialQuantity: 50 });
    expect(service.initialQuantity).toBe(0);
    expect(service.trackStock).toBe(false);
  });
});
