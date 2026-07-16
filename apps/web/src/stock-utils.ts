export function calculateStockAfter(
  current: number,
  quantity: number,
  increase: boolean,
) {
  return current + (increase ? quantity : -quantity);
}
