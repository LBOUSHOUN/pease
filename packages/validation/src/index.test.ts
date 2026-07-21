import { describe, expect, it } from "vitest";
import { loginSchema, ownerSchema, productCreateSchema, quickStockReceiptSchema } from "./index";
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
    expect(productCreateSchema.safeParse({ ...base, inventoryMode: "serialized", initialQuantity: 1 }).success).toBe(false);
    const service = productCreateSchema.parse({ ...base, productType: "service", initialQuantity: 50 });
    expect(service.initialQuantity).toBe(0);
    expect(service.trackStock).toBe(false);
  });
});
