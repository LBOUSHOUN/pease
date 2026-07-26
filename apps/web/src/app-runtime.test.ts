import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isNativeDesktop } from "./desktop-session";
import {
  getAppRuntimeStatus,
  nativeBookAssistantCapability,
  type AppRuntimeStatus,
} from "./app-runtime";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./desktop-session", () => ({ isNativeDesktop: vi.fn() }));

const status = (
  values: Partial<AppRuntimeStatus> = {},
): AppRuntimeStatus => ({
  isNative: true,
  isPackaged: false,
  ocrAvailable: true,
  ...values,
});

describe("capacité runtime de l’assistant livre", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isNativeDesktop).mockReset();
  });

  it("reste désactivée dans un navigateur/PWA sans commande native", async () => {
    vi.mocked(isNativeDesktop).mockReturnValue(false);
    await expect(getAppRuntimeStatus()).resolves.toEqual({
      isNative: false,
      isPackaged: false,
      ocrAvailable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Tauri dev sans override",
      status(),
      { development: true, developmentOverride: undefined },
      false,
    ],
    [
      "Tauri dev avec override mais sans OCR",
      status({ ocrAvailable: false }),
      { development: true, developmentOverride: "true" },
      false,
    ],
    [
      "Tauri dev avec override et OCR",
      status(),
      { development: true, developmentOverride: "true" },
      true,
    ],
    [
      "application empaquetée sans OCR",
      status({ isPackaged: true, ocrAvailable: false }),
      { development: false, developmentOverride: undefined },
      false,
    ],
    [
      "application empaquetée avec OCR",
      status({ isPackaged: true }),
      { development: false, developmentOverride: undefined },
      true,
    ],
    [
      "override ignoré par un build de production non empaqueté",
      status(),
      { development: false, developmentOverride: "true" },
      false,
    ],
    [
      "override refusé hors runtime natif",
      status({ isNative: false }),
      { development: true, developmentOverride: "true" },
      false,
    ],
  ])("%s", (_name, runtime, context, expected) => {
    expect(nativeBookAssistantCapability(runtime, context)).toBe(expected);
  });

  it("lit le statut uniquement par la commande native dédiée", async () => {
    vi.mocked(isNativeDesktop).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(
      status({ isPackaged: true, ocrAvailable: true }),
    );
    await expect(getAppRuntimeStatus()).resolves.toEqual(
      status({ isPackaged: true, ocrAvailable: true }),
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("get_app_runtime_status");
  });
});
