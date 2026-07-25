import { describe, expect, it } from "vitest";
import { isAbortError } from "./request-error";

describe("aborted request classification", () => {
  it.each([
    [Object.assign(new Error("cancelled"), { name: "AbortError" })],
    [new Error("signal is aborted without reason")],
    [new Error("The operation was aborted.")],
    [new Error("Request aborted")],
    [new Error("operation cancelled")],
    [new Error("request canceled")],
  ])("recognizes browser and Tauri aborts", (reason) => {
    expect(isAbortError(reason)).toBe(true);
  });

  it("does not suppress real API and network errors", () => {
    expect(isAbortError(new Error("Impossible de joindre le serveur."))).toBe(
      false,
    );
    expect(isAbortError({ name: "TypeError", message: "Failed to fetch" })).toBe(
      false,
    );
  });
});
