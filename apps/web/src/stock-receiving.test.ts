import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("scanner-first stock receiving", () => {
  const source = readFileSync(resolve(process.cwd(), "src/StockReceiving.tsx"), "utf8");
  it("uses exact product lookup and the atomic receipt endpoint", () => {
    expect(source).toContain("/products/lookup/");
    expect(source).toContain('request<ReceiptResult>("/stock/receipts"');
    expect(source).toContain("crypto.randomUUID()");
  });
  it("does not route a confirmed receipt to POS", () => {
    expect(source).not.toContain('navigate("/pos")');
    expect(source).not.toContain('to="/pos"');
  });
  it("keeps unknown codes visible and permission-gates creation", () => {
    expect(source).toContain("Produit inconnu");
    expect(source).toContain('permissions.includes("products.create")');
    expect(source).toContain("/products/new?barcode=");
  });
});
