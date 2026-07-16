import { describe, expect, it } from "vitest"; import { roles } from "./index";
describe("shared safe types",()=>{it("exposes the four established roles",()=>expect(roles).toEqual(["global_admin","manager","cashier","stock_worker"]));});
