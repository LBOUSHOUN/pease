import type {
  PriceAdjustmentType,
  ProductListRow,
} from "@maktaba/shared-types";
import { calculateAdjustedUnitPrice } from "@maktaba/validation";

export const DENOMINATIONS = [
  20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;
export const denominationTotal = (counts: Record<number, number>) =>
  DENOMINATIONS.reduce(
    (sum, value) => sum + value * Math.max(0, Math.floor(counts[value] ?? 0)),
    0,
  );

export interface CartPriceAdjustment {
  type: PriceAdjustmentType;
  value: number;
  reason: string;
  finalUnitPriceCents: number;
}
export type CartLine = {
  product: ProductListRow;
  quantity: number;
  unitBarcodes?: string[];
  priceAdjustment?: CartPriceAdjustment;
};

export const cartLineUnitPrice = (line: CartLine) =>
  line.priceAdjustment?.finalUnitPriceCents ?? line.product.sellingPriceCents;

export const calculateCartPriceAdjustment = (
  baseUnitPriceCents: number,
  type: PriceAdjustmentType,
  value: number,
  reason: string,
): CartPriceAdjustment => {
  const finalUnitPriceCents = calculateAdjustedUnitPrice(
    baseUnitPriceCents,
    type,
    value,
  );
  if (finalUnitPriceCents <= 0)
    throw new Error("Le prix final doit être supérieur à zéro.");
  if (finalUnitPriceCents === baseUnitPriceCents)
    throw new Error("Le nouveau prix doit être différent du prix normal.");
  if (reason.trim().length < 3)
    throw new Error("Indiquez la raison de la modification du prix.");
  return {
    type,
    value,
    reason: reason.trim(),
    finalUnitPriceCents,
  };
};

export const addCartProduct = (cart: CartLine[], product: ProductListRow) => {
  const found = cart.find((line) => line.product.id === product.id);
  return found
    ? cart.map((line) =>
        line.product.id === product.id
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      )
    : [...cart, { product, quantity: 1 }];
};
export const addSerializedCartUnit = (
  cart: CartLine[],
  product: ProductListRow,
  barcode: string,
) => {
  if (cart.some((line) => line.unitBarcodes?.includes(barcode))) return cart;
  const found = cart.find((line) => line.product.id === product.id);
  return found
    ? cart.map((line) =>
        line.product.id === product.id
          ? {
              ...line,
              quantity: line.quantity + 1,
              unitBarcodes: [...(line.unitBarcodes ?? []), barcode],
            }
          : line,
      )
    : [...cart, { product, quantity: 1, unitBarcodes: [barcode] }];
};
export const estimatedCartTotal = (cart: CartLine[]) =>
  cart.reduce(
    (sum, line) => sum + cartLineUnitPrice(line) * line.quantity,
    0,
  );
export const estimatedCredit = (total: number, cash: number) =>
  Math.max(0, total - cash);
export const remainingDebt = (debt: number, payment: number) => debt - payment;
