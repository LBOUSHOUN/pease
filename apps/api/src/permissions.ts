import type { Role } from "@maktaba/shared-types";
const all = [
  "dashboard.view",
  "settings.manage",
  "workers.manage",
  "products.view",
  "stock.view",
  "pos.use",
  "sales.view",
  "sales.create",
  "sales.return",
  "customers.view",
  "customers.credit",
  "suppliers.view",
  "purchases.create",
  "expenses.create",
  "register.open",
  "register.close",
  "reports.sales",
  "reports.profit",
  "exports.manage",
  "audit.view",
];
export function permissions(role: Role) {
  if (role === "global_admin") return all;
  if (role === "manager")
    return all.filter((x) => !["settings.manage", "audit.view"].includes(x));
  if (role === "cashier")
    return [
      "dashboard.view",
      "pos.use",
      "sales.view",
      "sales.create",
      "sales.return",
      "customers.view",
      "customers.credit",
      "register.open",
      "register.close",
    ];
  return [
    "dashboard.view",
    "products.view",
    "stock.view",
    "suppliers.view",
    "purchases.create",
  ];
}
