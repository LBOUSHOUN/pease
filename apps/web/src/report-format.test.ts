import { describe, expect, it } from "vitest";
import {
  columnsForReport,
  formatReportValue,
  registerReportColumns,
} from "./report-format";

describe("report presentation", () => {
  it("uses a fixed, translated register column order without internal ids", () => {
    expect(columnsForReport("registers", { id: 7 })).toEqual(
      registerReportColumns,
    );
    expect(registerReportColumns.map((column) => column.label)).toEqual([
      "Employé",
      "Ouverture",
      "Fermeture",
      "État",
      "Fond initial",
      "Ventes en espèces",
      "Paiements clients",
      "Paiements fournisseurs",
      "Dépenses",
      "Remboursements",
      "Solde attendu",
      "Solde compté",
      "Écart",
    ]);
  });

  it("distinguishes unavailable money from an actual zero", () => {
    const money = { key: "difference_cents", label: "Écart", kind: "money" as const };
    expect(formatReportValue(null, money)).toBe("—");
    expect(formatReportValue(undefined, money)).toBe("—");
    expect(formatReportValue(0, money)).toBe("0,00 MAD");
  });

  it("translates register states and formats dates in Casablanca time", () => {
    const status = { key: "status", label: "État", kind: "register-status" as const };
    const date = { key: "opened_at", label: "Ouverture", kind: "date" as const };
    expect(formatReportValue("open", status)).toBe("Ouverte");
    expect(formatReportValue("closed", status)).toBe("Fermée");
    expect(formatReportValue("2026-07-22T19:13:00Z", date)).toMatch(
      /22\/07\/2026.*20:13/,
    );
  });
});
