export type ReportColumn = {
  key: string;
  label: string;
  kind?: "money" | "date" | "register-status";
};

export const registerReportColumns: ReportColumn[] = [
  { key: "worker", label: "Employé" },
  { key: "opened_at", label: "Ouverture", kind: "date" },
  { key: "closed_at", label: "Fermeture", kind: "date" },
  { key: "status", label: "État", kind: "register-status" },
  { key: "opening_amount_cents", label: "Fond initial", kind: "money" },
  { key: "cash_sales_cents", label: "Ventes en espèces", kind: "money" },
  { key: "debt_payments_cents", label: "Paiements clients", kind: "money" },
  {
    key: "supplier_payments_cents",
    label: "Paiements fournisseurs",
    kind: "money",
  },
  { key: "expenses_cents", label: "Dépenses", kind: "money" },
  { key: "refunds_cents", label: "Remboursements", kind: "money" },
  { key: "expected_closing_cents", label: "Solde attendu", kind: "money" },
  { key: "actual_closing_cents", label: "Solde compté", kind: "money" },
  { key: "difference_cents", label: "Écart", kind: "money" },
];

export function columnsForReport(
  kind: string,
  firstRow?: Record<string, unknown>,
): ReportColumn[] {
  if (kind === "registers") return registerReportColumns;
  return Object.keys(firstRow ?? {}).map((key) => ({
    key,
    label: key.replaceAll("_", " ").replace(/cents$/, "MAD"),
    kind: key.includes("cents")
      ? "money"
      : /(?:_at|_date)$/.test(key)
        ? "date"
        : undefined,
  }));
}

export function formatReportValue(
  value: unknown,
  column: ReportColumn,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.kind === "money")
    return `${(Number(value) / 100).toFixed(2).replace(".", ",")} MAD`;
  if (column.kind === "register-status")
    return value === "open"
      ? "Ouverte"
      : value === "closed"
        ? "Fermée"
        : String(value);
  if (column.kind === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat("fr-MA", {
        timeZone: "Africa/Casablanca",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
  }
  return String(value);
}
