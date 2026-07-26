import { invoke } from "@tauri-apps/api/core";
import { isNativeDesktop } from "./desktop-session";

export type AppRuntimeStatus = {
  isNative: boolean;
  isPackaged: boolean;
  ocrAvailable: boolean;
};

type CapabilityContext = {
  development: boolean;
  developmentOverride?: string | boolean;
};

export function nativeBookAssistantCapability(
  status: AppRuntimeStatus,
  context: CapabilityContext,
) {
  const developmentOverride =
    context.development &&
    (context.developmentOverride === true ||
      context.developmentOverride === "true");
  return (
    status.isNative &&
    status.ocrAvailable &&
    (status.isPackaged || developmentOverride)
  );
}

export async function getAppRuntimeStatus(): Promise<AppRuntimeStatus> {
  if (!isNativeDesktop()) {
    return { isNative: false, isPackaged: false, ocrAvailable: false };
  }
  return invoke<AppRuntimeStatus>("get_app_runtime_status");
}

export async function detectNativeBookAssistantAvailability() {
  if (!isNativeDesktop()) return false;
  try {
    const status = await getAppRuntimeStatus();
    return nativeBookAssistantCapability(status, {
      development: import.meta.env.DEV,
      developmentOverride:
        import.meta.env.VITE_ENABLE_BOOK_ASSISTANT_IN_TAURI_DEV,
    });
  } catch {
    return false;
  }
}
