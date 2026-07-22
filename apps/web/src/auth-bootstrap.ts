import type { SafeUser } from "@maktaba/shared-types";
import { ApiFailure, request, type AuthResponse } from "./api";
import { loadDesktopSessionToken } from "./desktop-session";
import { getOfflineCacheStatus } from "./offline-pos";
import { evaluateOfflineEligibility, loadOfflineAuthSnapshot, saveOfflineAuthSnapshot, type OfflineEligibility } from "./offline-auth";
type BootstrapResult = { needsOwner: boolean; user: SafeUser | null; offline: boolean; offlineEligibility?: Extract<OfflineEligibility, { allowed: true }> };
export class OfflineColdStartError extends Error {
  constructor(readonly reason: Exclude<OfflineEligibility, { allowed: true }>["reason"]) {
    super(reason === "expired" ? "L’autorisation hors ligne a expiré. Reconnectez-vous au serveur." : "Une connexion au serveur est requise pour ouvrir une session.");
    this.name = "OfflineColdStartError";
  }
}
let initialization: Promise<BootstrapResult> | undefined;
export async function testApiHealth(timeoutMs = 3_500) {
  const controller = new AbortController(), timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request<{ status: string }>("/health", { method: "GET", cache: "no-store", skipDesktopAuth: true, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiFailure({ code: "TIMEOUT", message: "Le délai de connexion à l’API est dépassé." }, 0, undefined, "timeout");
    throw error;
  } finally { globalThis.clearTimeout(timeout); }
}
export function initializeAuth(): Promise<BootstrapResult> {
  initialization ??= (async () => {
    try {
      await testApiHealth();
    } catch {
      const [token, snapshot, cache] = await Promise.all([
        loadDesktopSessionToken(), loadOfflineAuthSnapshot(), getOfflineCacheStatus(),
      ]);
      const eligibility = evaluateOfflineEligibility(token, snapshot, cache);
      if (!eligibility.allowed) throw new OfflineColdStartError(eligibility.reason);
      return { needsOwner: false, user: eligibility.snapshot.user, offline: true, offlineEligibility: eligibility };
    }
    await loadDesktopSessionToken();
    const status = await request<{ needsOnboarding: boolean }>("/bootstrap/status");
    if (status.needsOnboarding) return { needsOwner: true, user: null, offline: false };
    const user = (await request<AuthResponse>("/auth/me")).user;
    await saveOfflineAuthSnapshot(user);
    return { needsOwner: false, user, offline: false };
  })()
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
export function resetAuthInitialization() {
  initialization = undefined;
}
