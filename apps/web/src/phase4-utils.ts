export type PurchaseDraftLine = {
  productId: number;
  name: string;
  quantity: number;
  purchaseUnitPriceCents: number;
};
export const purchaseTotal = (lines: PurchaseDraftLine[]) =>
  lines.reduce(
    (sum, line) => sum + line.quantity * line.purchaseUnitPriceCents,
    0,
  );
export const purchaseCredit = (
  total: number,
  mode: "cash" | "credit" | "partial",
  cash: number,
) =>
  mode === "cash" ? 0 : mode === "credit" ? total : Math.max(0, total - cash);
export const refundAllocation = (value: number, remainingCredit: number) => ({
  debtReductionCents: Math.min(value, Math.max(0, remainingCredit)),
  cashRefundCents: Math.max(0, value - Math.max(0, remainingCredit)),
});
export const supplierDebtAfterPayment = (debt: number, payment: number) =>
  debt - payment;
export const returnableQuantity = (sold: number, returned: number) =>
  Math.max(0, sold - returned);
