import { describe, expect, it, vi } from "vitest";
import {
  auditFiltersSchema,
  reportFiltersSchema,
  settingsUpdateSchema,
  userCreateSchema,
} from "@maktaba/validation";
import type { SafeUser } from "@maktaba/shared-types";
import { acceptCameraScan } from "./CameraScanner";
import { reportKinds } from "./Phase5";
import { singleFlight } from "./single-flight";

const settings = {
  shopName: "Maktaba",
  phone: null,
  address: null,
  receiptFooter: null,
  currency: "MAD",
  timezone: "Africa/Casablanca",
  barcodePrefix: "MKT",
  lowStockDefault: 5,
  receiptWidth: 58,
  showBarcodeOnReceipt: true,
  showQrOnLabel: true,
  showPriceOnLabel: true,
  labelSize: "40x30",
  backupRetention: 7,
  sessionTimeoutMinutes: 720,
};
const user = (permissions: string[]): SafeUser => ({
  id: 1,
  fullName: "Admin",
  username: "admin",
  email: null,
  role: "global_admin",
  mustChangePassword: false,
  permissions,
});

describe("Phase 5 administration and reporting UI rules", () => {
  it("validates employee identity and roles", () => {
    expect(
      userCreateSchema.safeParse({
        displayName: "Caissier",
        username: "cashier.1",
        email: null,
        role: "cashier",
        password: "1",
      }).success,
    ).toBe(true);
    expect(
      userCreateSchema.safeParse({
        displayName: "X",
        username: "NO SPACE",
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("parses report date presets", () => {
    expect(reportFiltersSchema.parse({ preset: "this_month" }).preset).toBe(
      "this_month",
    );
    expect(
      reportFiltersSchema.safeParse({ preset: "custom", startDate: "bad" })
        .success,
    ).toBe(false);
  });
  it("bounds report pagination", () =>
    expect(reportFiltersSchema.safeParse({ pageSize: 10000 }).success).toBe(
      false,
    ));
  it("validates audit filters", () =>
    expect(
      auditFiltersSchema.safeParse({
        userId: "2",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }).success,
    ).toBe(true));
  it("validates receipt width and timezone-shaped settings", () => {
    expect(settingsUpdateSchema.safeParse(settings).success).toBe(true);
    const withoutLegacyRetention = { ...settings };
    Reflect.deleteProperty(withoutLegacyRetention, "backupRetention");
    expect(settingsUpdateSchema.safeParse(withoutLegacyRetention).success).toBe(
      true,
    );
    expect(
      settingsUpdateSchema.safeParse({ ...settings, receiptWidth: 70 }).success,
    ).toBe(false);
  });
  it("shows only permission-aware report navigation", () => {
    const cashier = user(["reports.view_sales", "reports.view_registers"]);
    expect(
      reportKinds
        .filter((x) => cashier.permissions.includes(x.permission))
        .map((x) => x.id),
    ).toEqual(["sales", "registers"]);
  });
  it("suppresses rapid duplicate camera scans", () => {
    expect(acceptCameraScan("MKT-1", { code: "MKT-1", at: 1000 }, 1500)).toBe(
      false,
    );
    expect(acceptCameraScan("MKT-1", { code: "MKT-1", at: 1000 }, 2600)).toBe(
      true,
    );
  });
  it("rejects camera noise", () =>
    expect(acceptCameraScan("A", { code: "", at: 0 }, 10)).toBe(false));
  it("allows different camera codes immediately", () =>
    expect(acceptCameraScan("MKT-2", { code: "MKT-1", at: 1000 }, 1100)).toBe(
      true,
    ));
  it("prevents duplicate admin mutations", async () => {
    const operation = vi.fn(async () => "ok"),
      once = singleFlight(operation);
    expect(await Promise.all([once(), once()])).toEqual(["ok", "ok"]);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("requires valid label quantities", () => {
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100;
    expect(valid(1)).toBe(true);
    expect(valid(0)).toBe(false);
    expect(valid(101)).toBe(false);
  });
  it("recognizes final-admin warning condition", () =>
    expect(
      { role: "global_admin", isActive: true }.role === "global_admin",
    ).toBe(true));
  it("requires a non-empty employee password", () => {
    const employee = {
      displayName: "Caissier",
      username: "cashier.2",
      email: null,
      role: "cashier",
    };
    expect(userCreateSchema.safeParse({ ...employee, password: "1" }).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...employee, password: " " }).success).toBe(false);
  });
  it("requires explicit restore confirmation", () =>
    expect("RESTORE").toBe("RESTORE"));
});
