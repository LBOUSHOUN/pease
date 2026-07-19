import { barcodeValueSchema } from "@maktaba/validation";

export type BarcodePrefill = {
  barcode: string;
  error: string;
};

export function readBarcodePrefill(
  parameters: Pick<URLSearchParams, "get">,
  edit: boolean,
): BarcodePrefill {
  if (edit) return { barcode: "", error: "" };
  const raw = parameters.get("barcode");
  if (raw === null) return { barcode: "", error: "" };
  const parsed = barcodeValueSchema.safeParse(raw);
  return parsed.success
    ? { barcode: parsed.data, error: "" }
    : {
        barcode: "",
        error: "Le code-barres transmis est invalide. Saisissez-le manuellement.",
      };
}

export function applyBarcodePrefill(
  currentValue: string,
  prefill: string,
  manuallyChanged: boolean,
) {
  return manuallyChanged || currentValue ? currentValue : prefill;
}
