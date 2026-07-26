const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExtensions = /\.(?:jpe?g|png|webp)$/i;
export const MAX_BOOK_IMAGE_BYTES = 15 * 1024 * 1024;

export function validateBookImage(file: Pick<File, "name" | "size" | "type">) {
  if (!allowedTypes.has(file.type) || !allowedExtensions.test(file.name))
    return "Formats acceptés : JPG, JPEG, PNG ou WEBP.";
  if (file.size <= 0) return "Le fichier image est vide ou corrompu.";
  if (file.size > MAX_BOOK_IMAGE_BYTES)
    return "L’image dépasse la taille maximale de 15 Mo.";
  return null;
}

const digits = (value: string) =>
  value.toUpperCase().replace(/^ISBN(?:-1[03])?:?/i, "").replace(/[^0-9X]/g, "");
export function isValidIsbn13(value: string) {
  const code = digits(value);
  if (!/^97[89][0-9]{10}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce(
    (total, number, index) =>
      total + Number(number) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}
export function isValidIsbn10(value: string) {
  const code = digits(value);
  if (!/^[0-9]{9}[0-9X]$/.test(code)) return false;
  return [...code].reduce(
    (total, number, index) =>
      total + (number === "X" ? 10 : Number(number)) * (10 - index),
    0,
  ) % 11 === 0;
}
export function isbn10To13(value: string) {
  const code = digits(value);
  if (!isValidIsbn10(code)) return null;
  const base = `978${code.slice(0, 9)}`;
  const sum = [...base].reduce(
    (total, number, index) =>
      total + Number(number) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${base}${(10 - (sum % 10)) % 10}`;
}
export function normalizeIsbn(value: string) {
  const code = digits(value);
  if (isValidIsbn13(code))
    return { isbn13: code, isbn10: null as string | null };
  if (isValidIsbn10(code))
    return { isbn10: code, isbn13: isbn10To13(code) };
  return null;
}
export function findIsbnInText(value: string) {
  for (const candidate of value.match(/[0-9X][0-9X .-]{8,20}[0-9X]/gi) ?? []) {
    const normalized = normalizeIsbn(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function ocrSuggestions(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2 && line.length <= 200)
    .slice(0, 20);
  return {
    title: lines[0] ?? "",
    rawText: lines.join("\n").slice(0, 3000),
  };
}
