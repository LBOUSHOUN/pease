import { describe, expect, it } from "vitest";
import { permissions } from "../src/permissions.js";
import { validatePriceAdjustment } from "../src/price-adjustment.js";

describe("server-side sale price adjustment", () => {
  it("keeps the catalogue price when no adjustment is requested", () => {
    expect(validatePriceAdjustment(1000, 700, {}, permissions("cashier"))).toMatchObject({
      baseUnitPriceCents: 1000,
      finalUnitPriceCents: 1000,
      type: null,
    });
  });

  it("preserves a legacy zero catalogue price unless an authorized override is requested", () => {
    expect(validatePriceAdjustment(0, 0, {}, permissions("cashier"))).toMatchObject({
      baseUnitPriceCents: 0,
      finalUnitPriceCents: 0,
      type: null,
    });
    expect(
      validatePriceAdjustment(
        0,
        0,
        {
          finalUnitPriceCents: 500,
          priceAdjustmentType: "final_unit_price",
          priceAdjustmentValue: 500,
          priceAdjustmentReason: "Prix dÃ©fini au comptoir",
        },
        permissions("global_admin"),
      ).finalUnitPriceCents,
    ).toBe(500);
  });

  it("allows managers to negotiate a price but not sell below cost", () => {
    const manager = permissions("manager");
    expect(manager).toContain("sales.adjust_price");
    expect(manager).not.toContain("sales.sell_below_cost");
    expect(
      validatePriceAdjustment(
        1000,
        700,
        {
          finalUnitPriceCents: 850,
          priceAdjustmentType: "fixed_discount",
          priceAdjustmentValue: 150,
          priceAdjustmentReason: "Remise client",
        },
        manager,
      ).finalUnitPriceCents,
    ).toBe(850);
    expect(() =>
      validatePriceAdjustment(
        1000,
        900,
        {
          finalUnitPriceCents: 850,
          priceAdjustmentType: "fixed_discount",
          priceAdjustmentValue: 150,
          priceAdjustmentReason: "Remise client",
        },
        manager,
      ),
    ).toThrow("BELOW_COST");
  });

  it("rejects cashier overrides and validates the server calculation", () => {
    expect(() =>
      validatePriceAdjustment(
        1000,
        500,
        {
          finalUnitPriceCents: 900,
          priceAdjustmentType: "fixed_discount",
          priceAdjustmentValue: 100,
          priceAdjustmentReason: "Remise client",
        },
        permissions("cashier"),
      ),
    ).toThrow("PRICE_PERMISSION");
    expect(() =>
      validatePriceAdjustment(
        1000,
        500,
        {
          finalUnitPriceCents: 800,
          priceAdjustmentType: "fixed_discount",
          priceAdjustmentValue: 100,
          priceAdjustmentReason: "Remise client",
        },
        permissions("global_admin"),
      ),
    ).toThrow("PRICE_CALCULATION");
  });
});
