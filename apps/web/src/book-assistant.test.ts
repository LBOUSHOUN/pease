import { describe, expect, it } from "vitest";
import {
  findIsbnInText,
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  ocrSuggestions,
  validateBookImage,
} from "./book-assistant";

describe("assistant livre", () => {
  it("valide les images autorisées et rejette MIME, extension et taille", () => {
    expect(validateBookImage({ name: "livre.jpg", type: "image/jpeg", size: 10 })).toBeNull();
    expect(validateBookImage({ name: "livre.svg", type: "image/svg+xml", size: 10 })).toContain("Formats");
    expect(validateBookImage({ name: "livre.jpg.exe", type: "image/jpeg", size: 10 })).toContain("Formats");
    expect(validateBookImage({ name: "livre.webp", type: "image/webp", size: 16 * 1024 * 1024 })).toContain("15 Mo");
  });
  it("normalise et vérifie ISBN-10 et ISBN-13", () => {
    expect(isValidIsbn10("0-306-40615-2")).toBe(true);
    expect(isValidIsbn13("9780306406157")).toBe(true);
    expect(normalizeIsbn("ISBN 0-306-40615-2")).toEqual({
      isbn10: "0306406152",
      isbn13: "9780306406157",
    });
    expect(normalizeIsbn("9780306406158")).toBeNull();
  });
  it("extrait un ISBN du texte OCR sans interpréter de HTML", () => {
    expect(findIsbnInText("Code ISBN : 978-0-306-40615-7")?.isbn13).toBe(
      "9780306406157",
    );
    expect(ocrSuggestions("<script>alert(1)</script>\nAuteur").title).toBe(
      "<script>alert(1)</script>",
    );
  });
  it("conserve un repli manuel lorsque l’OCR ne retourne rien", () => {
    expect(ocrSuggestions(" \n ").title).toBe("");
    expect(findIsbnInText("aucun code lisible")).toBeNull();
  });
});
