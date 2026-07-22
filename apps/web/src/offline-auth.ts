import { invoke } from "@tauri-apps/api/core";
import type { SafeUser } from "@maktaba/shared-types";
import type { OfflineCacheStatus } from "./offline-pos";
import { isNativeDesktop } from "./desktop-session";

export const OFFLINE_AUTH_VALIDITY_MS = 12 * 60 * 60 * 1_000;
export const OFFLINE_SHOP_KEY = "single-shop";

export type OfflineAuthSnapshot = {
  schemaVersion: 1;
  shopKey: typeof OFFLINE_SHOP_KEY;
  user: SafeUser;
  cachedAt: string;
  validUntil: string;
};

export type OfflineEligibility =
  | { allowed: true; snapshot: OfflineAuthSnapshot; cache: OfflineCacheStatus }
  | { allowed: false; reason: "missing-token" | "missing-profile" | "expired" | "invalid-profile" | "missing-cache" | "shop-mismatch" };

export function createOfflineAuthSnapshot(user: SafeUser, now = new Date()): OfflineAuthSnapshot {
  return {
    schemaVersion: 1,
    shopKey: OFFLINE_SHOP_KEY,
    user,
    cachedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + OFFLINE_AUTH_VALIDITY_MS).toISOString(),
  };
}

export function evaluateOfflineEligibility(
  token: string | null,
  snapshot: OfflineAuthSnapshot | null,
  cache: OfflineCacheStatus | undefined,
  now = new Date(),
): OfflineEligibility {
  if (!token) return { allowed: false, reason: "missing-token" };
  if (!snapshot) return { allowed: false, reason: "missing-profile" };
  if (snapshot.schemaVersion !== 1 || !snapshot.user?.id || !snapshot.user.username || !Array.isArray(snapshot.user.permissions))
    return { allowed: false, reason: "invalid-profile" };
  if (snapshot.shopKey !== OFFLINE_SHOP_KEY) return { allowed: false, reason: "shop-mismatch" };
  const validUntil = Date.parse(snapshot.validUntil);
  if (!Number.isFinite(validUntil) || validUntil <= now.getTime()) return { allowed: false, reason: "expired" };
  if (!cache || cache.productCount < 1 || !cache.lastRefreshAt) return { allowed: false, reason: "missing-cache" };
  const refreshedAt = Date.parse(cache.lastRefreshAt);
  if (!Number.isFinite(refreshedAt) || refreshedAt > now.getTime() || now.getTime() - refreshedAt > OFFLINE_AUTH_VALIDITY_MS)
    return { allowed: false, reason: "missing-cache" };
  return { allowed: true, snapshot, cache };
}

export async function saveOfflineAuthSnapshot(user: SafeUser) {
  if (!isNativeDesktop()) return;
  await invoke("save_offline_auth_snapshot", { snapshotJson: JSON.stringify(createOfflineAuthSnapshot(user)) });
}

export async function loadOfflineAuthSnapshot(): Promise<OfflineAuthSnapshot | null> {
  if (!isNativeDesktop()) return null;
  return invoke<OfflineAuthSnapshot | null>("load_offline_auth_snapshot");
}

export async function clearOfflineAuthSnapshot() {
  if (!isNativeDesktop()) return;
  await invoke("clear_offline_auth_snapshot");
}
