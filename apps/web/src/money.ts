export function madToCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Saisissez un montant MAD avec deux décimales au maximum.");
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const centsToMad = (value: number) => `${(value / 100).toFixed(2)} MAD`;
