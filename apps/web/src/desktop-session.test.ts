import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: native.fetch }));
import { request } from "./api";
import { deleteDesktopSessionToken, loadDesktopSessionToken, resetDesktopSessionForTests, saveDesktopSessionToken } from "./desktop-session";

beforeEach(() => {
  native.invoke.mockReset();
  native.fetch.mockReset();
  native.isTauri.mockReturnValue(true);
  resetDesktopSessionForTests();
  vi.unstubAllGlobals();
});

describe("native desktop session", () => {
  it("restores a token after an application-style restart and adds it only natively", async () => {
    native.invoke.mockResolvedValueOnce("A".repeat(43));
    native.fetch.mockResolvedValue(new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }));
    await loadDesktopSessionToken();
    await request("/auth/me");
    const headers = new Headers((native.fetch.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe(`Bearer ${"A".repeat(43)}`);
    expect(headers.get("x-maktaba-client")).toBe("tauri-desktop");
  });
  it("uses the OS credential commands for save and delete", async () => {
    native.invoke.mockResolvedValue(undefined);
    await saveDesktopSessionToken("B".repeat(43));
    await deleteDesktopSessionToken();
    expect(native.invoke).toHaveBeenNthCalledWith(1, "save_desktop_session_token", { token: "B".repeat(43) });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "delete_desktop_session_token");
  });
  it("does not delete a stored token when the API is unavailable", async () => {
    native.invoke.mockResolvedValueOnce("C".repeat(43));
    native.fetch.mockRejectedValue(new TypeError("offline"));
    await expect(request("/auth/me")).rejects.toMatchObject({ status: 0 });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).not.toHaveBeenCalledWith("delete_desktop_session_token");
  });
  it("classifies a native command rejection separately from API downtime", async () => {
    native.invoke.mockResolvedValueOnce(null);
    native.fetch.mockRejectedValue(new Error("plugin invoke command failed"));
    await expect(request("/health", { skipDesktopAuth: true })).rejects.toMatchObject({ category: "tauri_command" });
  });
});
