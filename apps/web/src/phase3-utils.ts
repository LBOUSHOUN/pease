import type { ProductListRow } from "@maktaba/shared-types";

export const DENOMINATIONS = [
  20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;
export const denominationTotal = (counts: Record<number, number>) =>
  DENOMINATIONS.reduce(
    (sum, value) => sum + value * Math.max(0, Math.floor(counts[value] ?? 0)),
    0,
  );
export type CartLine = { product: ProductListRow; quantity: number };
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
export const estimatedCartTotal = (cart: CartLine[]) =>
  cart.reduce(
    (sum, line) => sum + line.product.sellingPriceCents * line.quantity,
    0,
  );
export const estimatedCredit = (total: number, cash: number) =>
  Math.max(0, total - cash);
export const remainingDebt = (debt: number, payment: number) => debt - payment;
