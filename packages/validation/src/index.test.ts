import { describe, expect, it } from "vitest";
import { loginSchema, ownerSchema } from "./index";
describe("online validation", () => {
  it("rejects weak owner passwords", () =>
    expect(
      ownerSchema.safeParse({
        shopName: "M",
        fullName: "Owner",
        username: "owner",
        email: "",
        password: "weak",
        barcodePrefix: "MKT",
      }).success,
    ).toBe(false));
  it("accepts credentials", () =>
    expect(
      loginSchema.safeParse({ login: "owner", password: "Secret123" }).success,
    ).toBe(true));
});
