import { describe, expect, it } from "vitest";
import {
  assertLocalPasswordResetAllowed,
  validateLocalResetPassword,
} from "../src/local-password-reset.js";

describe("local password reset safeguards", () => {
  it.each([
    "postgresql://user:secret@railway.example/database",
    "postgresql://user:secret@192.168.1.10/database",
    "https://127.0.0.1/database",
  ])("refuses a non-local PostgreSQL target", (databaseUrl) => {
    expect(() =>
      assertLocalPasswordResetAllowed(databaseUrl, "development"),
    ).toThrow(/refusée|localhost/);
  });

  it("refuses production mode even for localhost", () => {
    expect(() =>
      assertLocalPasswordResetAllowed(
        "postgresql://user:secret@127.0.0.1:5433/database",
        "production",
      ),
    ).toThrow(/production/);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "accepts the local host %s outside production",
    (host) => {
      const parsed =
        assertLocalPasswordResetAllowed(
          `postgresql://user:secret@${host}:5433/database`,
          "development",
        );
      expect(parsed.protocol).toBe("postgresql:");
    },
  );

  it("reuses the account password strength and confirmation rules", () => {
    expect(() => validateLocalResetPassword("short", "short")).toThrow();
    expect(() =>
      validateLocalResetPassword("Nouveau123", "Different123"),
    ).toThrow(/confirmation/);
    expect(validateLocalResetPassword("Nouveau123", "Nouveau123")).toBe(
      "Nouveau123",
    );
  });
});
