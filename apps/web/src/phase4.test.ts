import { describe, expect, it } from "vitest";
import {
  expenseCorrectionSchema,
  expenseCreateSchema,
  purchaseCreateSchema,
  returnCreateSchema,
  supplierCreateSchema,
  supplierPaymentSchema,
} from "@maktaba/validation";
import {
  purchaseCredit,
  purchaseTotal,
  refundAllocation,
  returnableQuantity,
  supplierDebtAfterPayment,
} from "./phase4-utils";

const key = "550e8400-e29b-41d4-a716-446655440000";

describe("Phase 4 financial rules", () => {
  const lines = [
    { productId: 1, name: "Cahier", quantity: 3, purchaseUnitPriceCents: 400 },
    { productId: 2, name: "Stylo", quantity: 2, purchaseUnitPriceCents: 175 },
  ];

  it("computes purchase totals in integer cents", () =>
    expect(purchaseTotal(lines)).toBe(1550));
  it.each([
    ["cash", 0],
    ["credit", 1550],
    ["partial", 950],
  ] as const)("computes %s purchase credit", (mode, expected) =>
    expect(purchaseCredit(1550, mode, 600)).toBe(expected),
  );
  it("allocates refunds to credit before cash", () => {
    expect(refundAllocation(500, 100)).toEqual({
      debtReductionCents: 100,
      cashRefundCents: 400,
    });
    expect(refundAllocation(500, 900)).toEqual({
      debtReductionCents: 500,
      cashRefundCents: 0,
    });
  });
  it("never creates negative refund buckets", () =>
    expect(refundAllocation(500, -20)).toEqual({
      debtReductionCents: 0,
      cashRefundCents: 500,
    }));
  it("previews supplier debt after payment", () =>
    expect(supplierDebtAfterPayment(1200, 450)).toBe(750));
  it("bounds returnable quantity at zero", () => {
    expect(returnableQuantity(5, 2)).toBe(3);
    expect(returnableQuantity(2, 4)).toBe(0);
  });
});

describe("Phase 4 request validation", () => {
  it("accepts normalized supplier contact data", () =>
    expect(
      supplierCreateSchema.safeParse({
        name: "Atlas Distribution",
        phone: null,
        email: "stock@atlas.ma",
        address: null,
        notes: null,
      }).success,
    ).toBe(true));
  it("rejects an empty supplier name", () =>
    expect(supplierCreateSchema.safeParse({ name: " " }).success).toBe(false));
  it("accepts a valid partial purchase", () =>
    expect(
      purchaseCreateSchema.safeParse({
        supplierId: 1,
        items: [{ productId: 2, quantity: 3, purchaseUnitPriceCents: 425 }],
        paymentMode: "partial",
        cashPaidCents: 500,
        paymentSource: "cash_register",
        invoiceNumber: null,
        invoiceDate: null,
        note: null,
        idempotencyKey: key,
      }).success,
    ).toBe(true));
  it("rejects zero purchase quantities", () =>
    expect(
      purchaseCreateSchema.safeParse({
        supplierId: 1,
        items: [{ productId: 2, quantity: 0, purchaseUnitPriceCents: 425 }],
        paymentMode: "credit",
        paymentSource: "external_cash",
        idempotencyKey: key,
      }).success,
    ).toBe(false));
  it("accepts register and external expenses", () => {
    for (const paymentSource of ["cash_register", "external_cash"])
      expect(
        expenseCreateSchema.safeParse({
          category: "Transport",
          description: "Livraison",
          amountCents: 2500,
          paymentSource,
          expenseDate: "2026-07-16",
          idempotencyKey: key,
        }).success,
      ).toBe(true);
  });
  it("requires a meaningful correction reason", () =>
    expect(
      expenseCorrectionSchema.safeParse({ reason: "x", idempotencyKey: key })
        .success,
    ).toBe(false));
  it("accepts mixed restock return lines", () =>
    expect(
      returnCreateSchema.safeParse({
        saleId: 3,
        items: [
          { saleItemId: 10, quantity: 1, restock: true },
          { saleItemId: 11, quantity: 2, restock: false },
        ],
        reason: "Article échangé",
        idempotencyKey: key,
      }).success,
    ).toBe(true));
  it("rejects excessive supplier payments at schema boundary", () =>
    expect(
      supplierPaymentSchema.safeParse({
        amountCents: 0,
        paymentSource: "external_cash",
        idempotencyKey: key,
      }).success,
    ).toBe(false));
});
