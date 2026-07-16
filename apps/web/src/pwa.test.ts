import { describe, expect, it } from "vitest";
import { shouldRegisterServiceWorker } from "./pwa";
describe("PWA development behavior", () => {
  it("never registers in development", () =>
    expect(shouldRegisterServiceWorker(false)).toBe(false));
  it("registers in production", () =>
    expect(shouldRegisterServiceWorker(true)).toBe(true));
});
