import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), request: mocks.request }));
import { initializeAuth, OfflineColdStartError, resetAuthInitialization, testApiHealth } from "./auth-bootstrap";
beforeEach(() => {
  resetAuthInitialization();
  mocks.request.mockReset();
});
describe("authentication initialization", () => {
  it("deduplicates StrictMode-style initialization", async () => {
    mocks.request
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce({ needsOnboarding: false })
      .mockResolvedValueOnce({ user: { id: 1 } });
    const [a, b] = await Promise.all([initializeAuth(), initializeAuth()]);
    expect(a).toEqual(b);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(mocks.request.mock.calls.map((x) => x[0])).toEqual([
      "/health", "/bootstrap/status",
      "/auth/me",
    ]);
  });
  it("does not request auth/me during onboarding", async () => {
    mocks.request.mockResolvedValueOnce({ status: "ok" }).mockResolvedValueOnce({ needsOnboarding: true });
    await initializeAuth();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("executes a fresh health request after a rejected bootstrap is reset", async () => {
    mocks.request.mockRejectedValueOnce(new Error("offline"));
    await expect(initializeAuth()).rejects.toMatchObject({ name: "OfflineColdStartError", reason: "missing-token" } satisfies Partial<OfflineColdStartError>);
    resetAuthInitialization();
    mocks.request.mockResolvedValueOnce({ status: "ok" }).mockResolvedValueOnce({ needsOnboarding: true });
    await initializeAuth();
    expect(mocks.request.mock.calls.filter((call) => call[0] === "/health")).toHaveLength(2);
  });
  it("classifies a health timeout as API unavailability", async () => {
    mocks.request.mockRejectedValueOnce(new DOMException("timeout", "AbortError"));
    await expect(testApiHealth()).rejects.toMatchObject({ status: 0, category: "timeout" });
  });
});
