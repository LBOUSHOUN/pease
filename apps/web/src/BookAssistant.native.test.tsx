// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SafeUser } from "@maktaba/shared-types";
import BookAssistant from "./BookAssistant";
import { request } from "./api";
import { analyzeBookCover, getNativeOcrStatus } from "./native-ocr";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, request: vi.fn() };
});
vi.mock("./native-ocr", () => ({
  analyzeBookCover: vi.fn(),
  getNativeOcrStatus: vi.fn(),
}));

const user: SafeUser = {
  id: 1,
  fullName: "Responsable",
  username: "manager",
  email: null,
  role: "manager",
  mustChangePassword: false,
  permissions: ["products.use_book_assistant"],
};

describe("assistant livre OCR natif", () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
    vi.mocked(request).mockResolvedValue({ rows: [] } as never);
    vi.mocked(getNativeOcrStatus).mockResolvedValue({
      available: true,
      languages: ["fra", "ara", "eng"],
      engineVersion: "tesseract 5",
      errorCode: null,
    });
    vi.mocked(analyzeBookCover).mockResolvedValue({
      title: "L’Étranger",
      author: "Albert Camus",
      isbn10: null,
      isbn13: "9780306406157",
      titleConfidence: 91,
      authorConfidence: 82,
      alternatives: [{ text: "L’Etranger", confidence: 72 }],
      detectedLanguages: ["fra"],
      warnings: [],
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:local"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(cleanup);

  it("préremplit uniquement les champs texte et garde le titre modifiable", async () => {
    render(<MemoryRouter><BookAssistant user={user} /></MemoryRouter>);
    const file = new File(["photo"], "cover.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Importer une image"), {
      target: { files: [file] },
    });
    const analyze = await screen.findByRole("button", { name: "Analyser la couverture" });
    fireEvent.click(analyze);
    fireEvent.click(analyze);

    await waitFor(() => expect(analyzeBookCover).toHaveBeenCalledOnce());
    expect(analyzeBookCover).toHaveBeenCalledWith(file, { titleRegion: false });
    expect(screen.getByLabelText("Titre")).toHaveValue("L’Étranger");
    expect(screen.getByLabelText("Auteur")).toHaveValue("Albert Camus");
    expect(screen.getByLabelText("ISBN-13")).toHaveValue("9780306406157");
    fireEvent.change(screen.getByLabelText("Titre"), {
      target: { value: "Titre corrigé" },
    });
    expect(screen.getByLabelText("Titre")).toHaveValue("Titre corrigé");
    expect(screen.getByText("L’Etranger")).toHaveAttribute("dir", "auto");
    fireEvent.click(screen.getByRole("button", { name: "Utiliser ce titre" }));
    expect(screen.getByLabelText("Titre")).toHaveValue("L’Etranger");
    vi.mocked(analyzeBookCover).mockResolvedValueOnce({
      title: "Autre résultat automatique",
      author: null,
      isbn10: null,
      isbn13: null,
      titleConfidence: 88,
      authorConfidence: null,
      alternatives: [],
      detectedLanguages: ["fra"],
      warnings: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(analyzeBookCover).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Titre")).toHaveValue("L’Etranger");
    expect(
      vi.mocked(request).mock.calls.some(([, options]) => {
        const json = options && "json" in options ? options.json : undefined;
        return JSON.stringify(json ?? {}).match(/image|blob|path/i);
      }),
    ).toBe(false);
  });
});
