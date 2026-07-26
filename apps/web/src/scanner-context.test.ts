import { describe, expect, it, vi } from "vitest";
import { ScannerContextRegistry } from "./scanner-context";

describe("scanner context priority", () => {
  it("dispatches one scan only to the highest active context", async () => {
    const registry = new ScannerContextRegistry();
    const fallback = vi.fn();
    const page = vi.fn();
    const field = vi.fn();
    registry.register("fallback", "fallback", () => true, fallback);
    registry.register("page", "page", () => true, page);
    registry.register("field", "field", () => true, field);

    expect(await registry.dispatch({ code: "00123ABC", source: "usb" })).toBe(true);
    expect(field).toHaveBeenCalledOnce();
    expect(page).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back deterministically when higher contexts are inactive", async () => {
    const registry = new ScannerContextRegistry();
    const fallback = vi.fn();
    const page = vi.fn();
    registry.register("fallback", "fallback", () => true, fallback);
    registry.register("page", "page", () => false, page);

    await registry.dispatch({ code: "00001", source: "camera" });
    expect(fallback).toHaveBeenCalledWith({ code: "00001", source: "camera" });
    expect(page).not.toHaveBeenCalled();
  });

  it("prevents concurrent duplicate dispatch", async () => {
    const registry = new ScannerContextRegistry();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(() => pending);
    registry.register("page", "page", () => true, handler);

    const first = registry.dispatch({ code: "ABC", source: "usb" });
    expect(await registry.dispatch({ code: "ABC", source: "usb" })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });
});
