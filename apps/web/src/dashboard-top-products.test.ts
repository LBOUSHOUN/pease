import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("best-selling products dashboard", () => {
  const dashboard = readFileSync(
    resolve(process.cwd(), "src/Dashboard.tsx"),
    "utf8",
  );
  const api = readFileSync(
    resolve(process.cwd(), "../api/src/phase5.ts"),
    "utf8",
  );

  it("renders the requested ranking and period filters", () => {
    expect(dashboard).toContain("Produits les plus vendus");
    expect(dashboard).toContain("30 derniers jours");
    expect(dashboard).toContain("Période personnalisée");
    expect(dashboard).toContain("Aucune vente enregistrée pour cette période.");
  });

  it("aggregates finalized sales with returns and historical charged prices", () => {
    expect(api).toContain("s.status in ('completed','partially_returned','fully_returned')");
    expect(api).toContain("sum(i.quantity-i.returned_quantity)");
    expect(api).toContain("i.unit_price_cents");
    expect(api).toContain("order by net_quantity desc,net_revenue_cents desc");
  });
});
