import { describe, expect, it } from "vitest";
import { loginSchema, ownerSchema } from "./index";
describe("online validation", () => {
  const owner = (password: string) =>
    ownerSchema.safeParse({
        shopName: "M",
        fullName: "Owner",
        username: "owner",
        email: "",
        password,
        barcodePrefix: "MKT",
      });
  it.each(["1", "0", "a", "12", "test"])(
    "accepts the non-empty password %s",
    (password) => expect(owner(password).success).toBe(true),
  );
  it.each(["", "   ", "\t"])("rejects an empty password", (password) =>
    expect(owner(password).success).toBe(false),
  );
  it("accepts credentials", () =>
    expect(
      loginSchema.safeParse({ login: "owner", password: "Secret123" }).success,
    ).toBe(true));
});
