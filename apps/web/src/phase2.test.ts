import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoryCreateSchema,
  categoryFiltersSchema,
  productCreateSchema,
  productFiltersSchema,
  stockAdjustmentSchema,
  stockFiltersSchema,
} from "@maktaba/validation";
import { request } from "./api";
import { centsToMad, madToCents } from "./money";
import { isEditable, ScannerBuffer } from "./scanner";
import { calculateStockAfter } from "./stock-utils";
import { readFileSync } from "node:fs";

afterEach(() => vi.unstubAllGlobals());

describe("Phase 2 web utilities", () => {
  it("renders the safe archive, restore and typed permanent-delete workflow", () => {
    const source = readFileSync(new URL("./Phase2.tsx", import.meta.url), "utf8");
    expect(source).toContain("Archiver ce produit ?");
    expect(source).toContain("Restaurer le produit ?");
    expect(source).toContain("Supprimer définitivement ce produit ?");
    expect(source).toContain("deleteEligible = product.canDeletePermanently === true");
    expect(source).toContain("Ce produit possède un historique et ne peut pas être supprimé. Archivez-le à la place.");
    expect(source).toContain("typed !== product.name");
    expect(source).toContain('useState("active")');
  });
  it("uses the actual rendered product action menu for list and detail lifecycle actions", () => {
    const source = readFileSync(new URL("./Phase2.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./style.css", import.meta.url), "utf8");
    expect(source).toContain("function ProductActionsMenu");
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("<ProductActionsMenu product={x} user={user}");
    expect(source).toContain("product-detail-actions");
    expect(source).toContain("showDeleteExplanation");
    expect(styles).toContain(".action-menu-panel");
    expect(styles).toContain("z-index: 20");
  });
  it("converts MAD without floating-point rounding", () => {
    expect(madToCents("12.34")).toBe(1234);
    expect(madToCents("12,3")).toBe(1230);
    expect(centsToMad(1234)).toBe("12.34 MAD");
  });
  it("rejects more than two decimal places", () =>
    expect(() => madToCents("1.234")).toThrow("deux décimales"));
  it("validates category forms and list filters", () => {
    expect(categoryCreateSchema.safeParse({ name: " " }).success).toBe(false);
    expect(categoryCreateSchema.parse({ name: " Cahiers " }).name).toBe(
      "Cahiers",
    );
    expect(categoryFiltersSchema.parse({ status: "inactive" }).status).toBe(
      "inactive",
    );
  });
  it("forces services to disable stock", () => {
    const value = productCreateSchema.parse({
      categoryId: 1,
      name: "Photocopie",
      productType: "service",
      purchasePriceCents: 0,
      sellingPriceCents: 100,
      trackStock: true,
    });
    expect(value.trackStock).toBe(false);
    expect(value.minimumStock).toBe(0);
  });
  it("parses product and stock filter flags safely", () => {
    expect(productFiltersSchema.parse({ status: "inactive" }).status).toBe(
      "inactive",
    );
    const stock = stockFiltersSchema.parse({
      lowStockOnly: "true",
      outOfStockOnly: "false",
    });
    expect(stock.lowStockOnly).toBe(true);
    expect(stock.outOfStockOnly).toBe(false);
  });
  it("validates stock direction and reason", () => {
    expect(
      stockAdjustmentSchema.safeParse({
        productId: 1,
        movementType: "manual_adjustment",
        quantity: 1,
        reason: "ok",
      }).success,
    ).toBe(false);
    expect(
      stockAdjustmentSchema.safeParse({
        productId: 1,
        movementType: "stock_in",
        quantity: 1,
        reason: "Entrée",
      }).success,
    ).toBe(true);
  });
  it("calculates stock previews for increases and decreases", () => {
    expect(calculateStockAfter(10, 3, true)).toBe(13);
    expect(calculateStockAfter(10, 3, false)).toBe(7);
    expect(calculateStockAfter(1, 2, false)).toBe(-1);
  });
  it("detects editable scanner targets without a browser DOM", () => {
    const target = (match: boolean, contentEditable = false) =>
      ({
        matches: () => match,
        isContentEditable: contentEditable,
      }) as unknown as EventTarget;
    expect(isEditable(target(true))).toBe(true);
    expect(isEditable(target(false, true))).toBe(true);
    expect(isEditable(target(false))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
  it("buffers fast scanner input ending with Enter", () => {
    const emit = vi.fn(),
      buffer = new ScannerBuffer(emit);
    for (const [i, key] of [..."MKT-001"].entries())
      buffer.key(key, 100 + i * 20);
    buffer.key("Enter", 260);
    expect(emit).toHaveBeenCalledWith("MKT-001");
  });
  it("ignores normal slow typing", () => {
    const emit = vi.fn(),
      buffer = new ScannerBuffer(emit);
    for (const [i, key] of [..."MKT-001"].entries())
      buffer.key(key, 100 + i * 200);
    buffer.key("Enter", 1600);
    expect(emit).not.toHaveBeenCalled();
  });
  it("prevents rapid duplicate scans", () => {
    const emit = vi.fn(),
      buffer = new ScannerBuffer(emit);
    for (const start of [100, 300]) {
      for (const [i, key] of [..."ABC"].entries())
        buffer.key(key, start + i * 10);
      buffer.key("Enter", start + 40);
    }
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("allows the same scan after the duplicate window", () => {
    const emit = vi.fn(),
      buffer = new ScannerBuffer(emit);
    for (const start of [100, 1000]) {
      for (const [i, key] of [..."ABC"].entries())
        buffer.key(key, start + i * 10);
      buffer.key("Enter", start + 40);
    }
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it("preserves a safe server 404 message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "NOT_FOUND",
            message: "Produit introuvable.",
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(request("/products/999")).rejects.toThrow(
      "Produit introuvable.",
    );
  });
  it("propagates AbortError for stale request cancellation", async () => {
    const aborted = new DOMException("stale", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(request("/products")).rejects.toBe(aborted);
  });
});
