import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseBackupStorage } from "../src/backup/storage.js";

afterEach(() => vi.unstubAllGlobals());
describe("private Supabase backup storage", () => {
  it("accepts only an existing private bucket", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ public: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SupabaseBackupStorage("https://example.supabase.co", "service-secret", "double-backups").assertPrivateBucket()).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: "Bearer service-secret", apikey: "service-secret" });
  });
  it("rejects a public or missing bucket", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ public: true }), { status: 200 })));
    await expect(new SupabaseBackupStorage("https://example.supabase.co", "key", "double-backups").assertPrivateBucket()).rejects.toThrow("privé");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    await expect(new SupabaseBackupStorage("https://example.supabase.co", "key", "double-backups").assertPrivateBucket()).rejects.toThrow("404");
  });
  it("propagates upload failures and forbids overwrite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("failed", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SupabaseBackupStorage("https://example.supabase.co", "key", "double-backups").upload("daily/a.dump", Buffer.from("data"), "application/octet-stream")).rejects.toThrow("503");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ "x-upsert": "false" });
  });
});
