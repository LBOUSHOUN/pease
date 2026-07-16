import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./single-flight";
describe("single-flight actions", () => {
  it("prevents duplicate logout clicks", async () => {
    let release!: () => void;
    const action = vi.fn(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      ),
      logout = singleFlight(action);
    const a = logout(),
      b = logout();
    expect(action).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b]);
  });
});
