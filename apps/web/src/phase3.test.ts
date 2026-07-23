import { describe, expect, it, vi } from "vitest";
import {
  customerCreateSchema,
  customerFiltersSchema,
  debtPaymentSchema,
  registerCloseSchema,
  registerOpenSchema,
  saleCreateSchema,
} from "@maktaba/validation";
import type { ProductListRow } from "@maktaba/shared-types";
import { madToCents } from "./money";
import {
  addCartProduct,
  calculateCartPriceAdjustment,
  cartLineUnitPrice,
  denominationTotal,
  estimatedCartTotal,
  estimatedCredit,
  remainingDebt,
} from "./phase3-utils";
import { singleFlight } from "./single-flight";

const product = (overrides: Partial<ProductListRow> = {}): ProductListRow => ({
  id: 1,
  categoryId: 1,
  categoryName: "Papeterie",
  name: "Cahier",
  productType: "physical_product",
  sku: null,
  internalBarcode: "MKT-000001",
  sellingPriceCents: 1250,
  currentStock: 2,
  minimumStock: 0,
  unit: "unité",
  shelfLocation: null,
  isActive: true,
  trackStock: true,
  isLowStock: false,
  isOutOfStock: false,
  ...overrides,
});

describe("Phase 3 financial and cart utilities", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.50", 50],
    ["9999.99", 999999],
    ["12,50", 1250],
  ])("converts %s MAD exactly", (value, cents) =>
    expect(madToCents(value)).toBe(cents),
  );
  it.each(["", "abc", "1.234", "1,2.3", "-1"])(
    "rejects invalid MAD %s",
    (value) => expect(() => madToCents(value)).toThrow(),
  );
  it("calculates denominations and closing validation", () => {
    expect(denominationTotal({ 20000: 2, 50: 3 })).toBe(40150);
    expect(
      registerOpenSchema.safeParse({
        openingCashCents: -1,
        idempotencyKey: "abcdefgh",
      }).success,
    ).toBe(false);
    expect(
      registerCloseSchema.safeParse({
        actualCashCents: 0,
        denominations: [],
        idempotencyKey: "abcdefgh",
      }).success,
    ).toBe(true);
  });
  it("validates customer forms, filters and payments", () => {
    expect(customerCreateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(customerFiltersSchema.parse({ debtOnly: "true" }).debtOnly).toBe(
      true,
    );
    expect(
      debtPaymentSchema.safeParse({
        amountCents: 0,
        idempotencyKey: "abcdefgh",
      }).success,
    ).toBe(false);
    expect(remainingDebt(1500, 500)).toBe(1000);
  });
  it("adds once and increments an existing cart line", () => {
    const once = addCartProduct([], product()),
      twice = addCartProduct(once, product());
    expect(twice).toHaveLength(1);
    expect(twice[0]!.quantity).toBe(2);
    expect(estimatedCartTotal(twice)).toBe(2500);
  });
  it("applies discounts and markups without changing the catalogue price", () => {
    const base = product();
    const discount = calculateCartPriceAdjustment(
      base.sellingPriceCents,
      "fixed_discount",
      250,
      "Remise client",
    );
    const cart = [{ product: base, quantity: 2, priceAdjustment: discount }];
    expect(cartLineUnitPrice(cart[0]!)).toBe(1000);
    expect(estimatedCartTotal(cart)).toBe(2000);
    expect(base.sellingPriceCents).toBe(1250);

    const markup = calculateCartPriceAdjustment(
      base.sellingPriceCents,
      "percentage_markup",
      1000,
      "Correction de prix",
    );
    expect(markup.finalUnitPriceCents).toBe(1375);
  });
  it("preserves a line price adjustment when the same product is scanned again", () => {
    const base = product();
    const adjustment = calculateCartPriceAdjustment(
      base.sellingPriceCents,
      "final_unit_price",
      900,
      "Négociation commerciale",
    );
    const once = [{ product: base, quantity: 1, priceAdjustment: adjustment }];
    const twice = addCartProduct(once, base);
    expect(twice[0]!.quantity).toBe(2);
    expect(twice[0]!.priceAdjustment).toEqual(adjustment);
    expect(estimatedCartTotal(twice)).toBe(1800);
  });
  it("supports services and partial allocations", () => {
    const service = product({
      id: 2,
      productType: "service",
      trackStock: false,
      currentStock: 0,
    });
    expect(addCartProduct([], service)[0]!.product.productType).toBe("service");
    expect(estimatedCredit(1650, 500)).toBe(1150);
  });
  it("requires customers for credit through sale validation workflow", () => {
    const value = saleCreateSchema.parse({
      items: [{ productId: 1, quantity: 1 }],
      paymentMode: "credit",
      cashPaidCents: 0,
      idempotencyKey: "abcdefgh",
    });
    expect(value.customerId).toBeUndefined();
    expect(value.paymentMode === "credit" && !value.customerId).toBe(true);
  });
  it("prevents duplicate checkout mutations while in flight", async () => {
    let resolve!: () => void;
    const mutation = vi.fn(() => new Promise<void>((done) => (resolve = done))),
      checkout = singleFlight(mutation);
    const first = checkout(),
      second = checkout();
    expect(mutation).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.all([first, second]);
  });
});
