import { describe, expect, it } from "vitest";
import { analyzeBarcodeImport } from "./serialized-import";

describe("serialized barcode import", () => {
  it("accepts multiline and CSV first-column values", () => {
    expect(analyzeBarcodeImport("barcode\n611000001\n611000002;note\n611000003,other", 5).valid)
      .toEqual(["611000001", "611000002", "611000003"]);
  });
  it("reports duplicates, invalid values and values beyond the dynamic remainder", () => {
    const result = analyzeBarcodeImport("611000001\n611000001\nx\n611000002\n611000003", 2);
    expect(result.valid).toEqual(["611000001", "611000002"]);
    expect(result.duplicate).toEqual(["611000001"]);
    expect(result.invalid).toEqual(["x"]);
    expect(result.extra).toEqual(["611000003"]);
  });
});
