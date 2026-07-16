import { describe, expect, it } from "vitest";
import { loginSchema, ownerSchema } from "@maktaba/validation";
describe("web validation", () => {
  it("accepts valid onboarding", () =>
    expect(
      ownerSchema.safeParse({
        shopName: "Maktaba",
        fullName: "Propriétaire",
        username: "owner",
        email: "",
        password: "Secret123",
        barcodePrefix: "MKT",
      }).success,
    ).toBe(true));
  it("rejects empty login", () =>
    expect(loginSchema.safeParse({ login: "", password: "" }).success).toBe(
      false,
    ));
});
