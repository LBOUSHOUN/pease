import {
  calculateAdjustedUnitPrice,
  type PriceAdjustmentType,
} from "@maktaba/validation";

export interface RequestedPriceAdjustment {
  finalUnitPriceCents?: number;
  priceAdjustmentType?: PriceAdjustmentType;
  priceAdjustmentValue?: number;
  priceAdjustmentReason?: string;
}

export interface ValidatedPriceAdjustment {
  baseUnitPriceCents: number;
  finalUnitPriceCents: number;
  type: PriceAdjustmentType | null;
  value: number | null;
  reason: string | null;
  discountPerUnitCents: number;
  markupPerUnitCents: number;
}

export function validatePriceAdjustment(
  baseUnitPriceCents: number,
  purchasePriceCents: number,
  requested: RequestedPriceAdjustment,
  permissions: readonly string[],
): ValidatedPriceAdjustment {
  const finalUnitPriceCents = requested.finalUnitPriceCents;
  if (finalUnitPriceCents === undefined)
    return {
      baseUnitPriceCents,
      finalUnitPriceCents: baseUnitPriceCents,
      type: null,
      value: null,
      reason: null,
      discountPerUnitCents: 0,
      markupPerUnitCents: 0,
    };

  if (!permissions.includes("sales.adjust_price"))
    throw new Error("PRICE_PERMISSION");

  const type = requested.priceAdjustmentType;
  const value = requested.priceAdjustmentValue;
  const reason = requested.priceAdjustmentReason?.trim();
  if (!type || value === undefined || !reason || reason.length < 3)
    throw new Error("PRICE_DATA");

  const expected = calculateAdjustedUnitPrice(baseUnitPriceCents, type, value);
  if (
    !Number.isInteger(finalUnitPriceCents) ||
    finalUnitPriceCents <= 0 ||
    expected !== finalUnitPriceCents
  )
    throw new Error("PRICE_CALCULATION");
  if (expected === baseUnitPriceCents) throw new Error("PRICE_UNCHANGED");
  if (
    purchasePriceCents > 0 &&
    expected < purchasePriceCents &&
    !permissions.includes("sales.sell_below_cost")
  )
    throw new Error("BELOW_COST");

  return {
    baseUnitPriceCents,
    finalUnitPriceCents: expected,
    type,
    value,
    reason,
    discountPerUnitCents: Math.max(0, baseUnitPriceCents - expected),
    markupPerUnitCents: Math.max(0, expected - baseUnitPriceCents),
  };
}
