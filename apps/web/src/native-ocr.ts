import { invoke } from "@tauri-apps/api/core";
import { isNativeDesktop } from "./desktop-session";

export type OcrStatus = {
  available: boolean;
  languages: string[];
  engineVersion: string | null;
  errorCode: string | null;
};

export type BookOcrResult = {
  title: string | null;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  titleConfidence: number | null;
  authorConfidence: number | null;
  alternatives: Array<{
    text: string;
    confidence: number | null;
    language?: string | null;
  }>;
  detectedLanguages: string[];
  warnings: string[];
};

const messages: Record<string, string> = {
  OCR_UNAVAILABLE: "Le module de lecture locale n’est pas disponible sur cet appareil.",
  OCR_INVALID_IMAGE: "Cette image est illisible ou endommagée.",
  OCR_UNSUPPORTED_FORMAT: "Format non pris en charge. Utilisez JPG, PNG ou WEBP.",
  OCR_IMAGE_TOO_LARGE: "L’image est trop volumineuse. Choisissez une image plus petite.",
  OCR_TIMEOUT: "L’analyse a pris trop de temps. Recadrez la couverture puis réessayez.",
  OCR_NO_TEXT: "Aucun texte fiable n’a été détecté. Saisissez le nom manuellement.",
  OCR_LANGUAGE_UNAVAILABLE: "Les fichiers de langue nécessaires ne sont pas installés.",
  OCR_PROCESS_FAILED: "L’analyse locale a échoué. Réessayez avec une photo plus nette.",
  OCR_TEMP_CLEANUP_FAILED: "Le nettoyage temporaire a échoué. Redémarrez l’application.",
};

export class NativeOcrError extends Error {
  constructor(public readonly code: string) {
    super(messages[code] ?? messages.OCR_PROCESS_FAILED);
    this.name = "NativeOcrError";
  }
}

function failureCode(reason: unknown) {
  if (reason && typeof reason === "object" && "code" in reason) {
    const code = String((reason as { code: unknown }).code);
    if (code.startsWith("OCR_")) return code;
  }
  const raw = reason instanceof Error ? reason.message : String(reason ?? "");
  return Object.keys(messages).find((code) => raw.includes(code)) ?? "OCR_PROCESS_FAILED";
}

export async function getNativeOcrStatus(): Promise<OcrStatus> {
  if (!isNativeDesktop())
    return {
      available: false,
      languages: [],
      engineVersion: null,
      errorCode: "BROWSER_NOT_NATIVE",
    };
  try {
    return await invoke<OcrStatus>("get_ocr_status");
  } catch {
    return {
      available: false,
      languages: [],
      engineVersion: null,
      errorCode: "OCR_UNAVAILABLE",
    };
  }
}

export async function analyzeBookCover(
  file: File,
  options: { titleRegion?: boolean } = {},
): Promise<BookOcrResult> {
  if (!isNativeDesktop()) throw new NativeOcrError("OCR_UNAVAILABLE");
  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    return await invoke<BookOcrResult>("extract_book_metadata_from_image", {
      imageBytes: bytes,
      mimeType: file.type,
      titleRegion: options.titleRegion ?? false,
    });
  } catch (reason) {
    throw new NativeOcrError(failureCode(reason));
  }
}
