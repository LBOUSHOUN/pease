import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isNativeDesktop } from "./desktop-session";
import { analyzeBookCover, getNativeOcrStatus, NativeOcrError } from "./native-ocr";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./desktop-session", () => ({ isNativeDesktop: vi.fn() }));

describe("pont OCR natif", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isNativeDesktop).mockReturnValue(true);
  });

  it("transfère uniquement les octets et le MIME à la commande Tauri", async () => {
    const result = { title: "كتاب", alternatives: [] };
    vi.mocked(invoke).mockResolvedValue(result);
    const file = {
      type: "image/png",
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as File;
    await expect(analyzeBookCover(file)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledWith("extract_book_metadata_from_image", {
      imageBytes: [137, 80, 78, 71],
      mimeType: "image/png",
      titleRegion: false,
    });
  });

  it("n’annonce pas l’OCR natif dans le navigateur", async () => {
    vi.mocked(isNativeDesktop).mockReturnValue(false);
    await expect(getNativeOcrStatus()).resolves.toMatchObject({
      available: false,
      errorCode: "BROWSER_NOT_NATIVE",
    });
    await expect(
      analyzeBookCover({ type: "image/jpeg" } as File),
    ).rejects.toBeInstanceOf(NativeOcrError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("marque une zone recadrée pour sélectionner les PSM natifs adaptés", async () => {
    vi.mocked(invoke).mockResolvedValue({ title: "Titre", alternatives: [] });
    const crop = {
      type: "image/png",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    await analyzeBookCover(crop, { titleRegion: true });
    expect(invoke).toHaveBeenCalledWith("extract_book_metadata_from_image", {
      imageBytes: [1, 2, 3],
      mimeType: "image/png",
      titleRegion: true,
    });
  });
});
