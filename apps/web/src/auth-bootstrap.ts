import type { SafeUser } from "@maktaba/shared-types";
import { request, type AuthResponse } from "./api";
type BootstrapResult = { needsOwner: boolean; user: SafeUser | null };
let initialization: Promise<BootstrapResult> | undefined;
export function initializeAuth(): Promise<BootstrapResult> {
  initialization ??= request<{ needsOnboarding: boolean }>("/bootstrap/status")
    .then(async (status) => ({
      needsOwner: status.needsOnboarding,
      user: status.needsOnboarding
        ? null
        : (await request<AuthResponse>("/auth/me")).user,
    }))
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
export function resetAuthInitialization() {
  initialization = undefined;
}
