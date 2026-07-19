import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBarcodePrefill, readBarcodePrefill } from "./product-create-flow";

describe("unknown-barcode product creation", () => {
  it("reads and normalizes the scanned barcode query", () => {
    expect(readBarcodePrefill(new URLSearchParams("barcode=%20611999%20"), false)).toEqual({
      barcode: "611999",
      error: "",
    });
  });

  it("rejects malformed barcode parameters safely", () => {
    const result = readBarcodePrefill(new URLSearchParams(`barcode=${"X".repeat(101)}`), false);
    expect(result.barcode).toBe("");
    expect(result.error).toContain("invalide");
  });

  it("never overwrites a manual barcode value", () => {
    expect(applyBarcodePrefill("MANUEL-1", "SCAN-1", true)).toBe("MANUEL-1");
    expect(applyBarcodePrefill("MANUEL-1", "SCAN-1", false)).toBe("MANUEL-1");
  });

  it("does not prefill product edit mode", () => {
    expect(readBarcodePrefill(new URLSearchParams("barcode=SCAN-1"), true)).toEqual({
      barcode: "",
      error: "",
    });
  });

  it("keeps the unknown scan action linked to product creation", () => {
    const phase3 = readFileSync(resolve(process.cwd(), "src/Phase3.tsx"), "utf8");
    expect(phase3).toContain("/products/new?barcode=");
    expect(phase3).toContain("Créer ce produit");
  });

  it("can enqueue the created barcode and return to POS", () => {
    const phase2 = readFileSync(resolve(process.cwd(), "src/Phase2.tsx"), "utf8");
    expect(phase2).toContain("enqueueGlobalScan(created.manufacturerBarcode!");
    expect(phase2).toContain('nav("/pos", { replace: true })');
    expect(phase2).toContain("setSearchParams({}, { replace: true })");
  });
});
