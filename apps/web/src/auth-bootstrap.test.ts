import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ request: mocks.request }));
import { initializeAuth, resetAuthInitialization } from "./auth-bootstrap";
beforeEach(() => {
  resetAuthInitialization();
  mocks.request.mockReset();
});
describe("authentication initialization", () => {
  it("deduplicates StrictMode-style initialization", async () => {
    mocks.request
      .mockResolvedValueOnce({ needsOnboarding: false })
      .mockResolvedValueOnce({ user: { id: 1 } });
    const [a, b] = await Promise.all([initializeAuth(), initializeAuth()]);
    expect(a).toEqual(b);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls.map((x) => x[0])).toEqual([
      "/bootstrap/status",
      "/auth/me",
    ]);
  });
  it("does not request auth/me during onboarding", async () => {
    mocks.request.mockResolvedValueOnce({ needsOnboarding: true });
    await initializeAuth();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
