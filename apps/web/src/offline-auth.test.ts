import { describe, expect, it } from "vitest";
import type { SafeUser } from "@maktaba/shared-types";
import { createOfflineAuthSnapshot, evaluateOfflineEligibility, OFFLINE_AUTH_VALIDITY_MS } from "./offline-auth";

const user: SafeUser = {
  id: 7, fullName: "Gérante", username: "gerante", email: null,
  role: "manager", mustChangePassword: false, permissions: ["pos.use", "register.view"],
};
const cache = {
  productCount: 4, serializedUnitCount: 0, availableSerializedUnitCount: 0,
  pendingSerializedUnitCount: 0, lastRefreshAt: "2026-07-22T08:00:00.000Z",
  register: { isOpen: true, sessionId: 9 },
};

describe("secure offline cold-start eligibility", () => {
  it("allows the same cached user with a native token and valid POS cache", () => {
    const now = new Date("2026-07-22T09:00:00.000Z");
    expect(evaluateOfflineEligibility("native-token", createOfflineAuthSnapshot(user, now), cache, now)).toMatchObject({ allowed: true });
  });
  it("rejects cold-start without a Credential Manager token", () => {
    expect(evaluateOfflineEligibility(null, createOfflineAuthSnapshot(user), cache)).toEqual({ allowed: false, reason: "missing-token" });
  });
  it("rejects cold-start without a cached profile or POS cache", () => {
    expect(evaluateOfflineEligibility("token", null, cache)).toEqual({ allowed: false, reason: "missing-profile" });
    expect(evaluateOfflineEligibility("token", createOfflineAuthSnapshot(user), undefined)).toEqual({ allowed: false, reason: "missing-cache" });
  });
  it("expires local authorization after twelve hours", () => {
    const created = new Date("2026-07-22T00:00:00.000Z");
    const result = evaluateOfflineEligibility("token", createOfflineAuthSnapshot(user, created), cache, new Date(created.getTime() + OFFLINE_AUTH_VALIDITY_MS + 1));
    expect(result).toEqual({ allowed: false, reason: "expired" });
  });
  it("rejects a profile from another shop scope", () => {
    const snapshot = { ...createOfflineAuthSnapshot(user), shopKey: "other-shop" };
    expect(evaluateOfflineEligibility("token", snapshot as never, cache)).toEqual({ allowed: false, reason: "shop-mismatch" });
  });
});
