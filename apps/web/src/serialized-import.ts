import { barcodeValueSchema } from "@maktaba/validation";

export type BarcodeImportAnalysis = {
  valid: string[];
  duplicate: string[];
  invalid: string[];
  extra: string[];
};

export function analyzeBarcodeImport(value: string, remaining: number): BarcodeImportAnalysis {
  const raw = value
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const first = trimmed.split(/[;,]/, 1)[0]!.trim().replace(/^"|"$/g, "");
      return /^(barcode|code[-_ ]?barres|code unitaire)$/i.test(first) ? [] : [first];
    });
  const seen = new Set<string>();
  const valid: string[] = [], duplicate: string[] = [], invalid: string[] = [];
  for (const candidate of raw) {
    const parsed = barcodeValueSchema.safeParse(candidate);
    if (!parsed.success) { invalid.push(candidate); continue; }
    const key = parsed.data.toLowerCase();
    if (seen.has(key)) { duplicate.push(parsed.data); continue; }
    seen.add(key); valid.push(parsed.data);
  }
  const extra = valid.slice(Math.max(0, remaining));
  return { valid: valid.slice(0, Math.max(0, remaining)), duplicate, invalid, extra };
}
