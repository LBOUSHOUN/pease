import { describe, expect, it } from "vitest";
import { assertNonEmptyDump, assertSupportedPgDumpVersion, backupFilename, backupObjectPath, categoriesFor, createManifest, manifestPath, retentionDeletes, sanitizeError } from "../src/backup/core.js";

const date = new Date("2026-07-22T03:04:05.123Z");
describe("automated PostgreSQL backup logic", () => {
  it("generates stable UTC filenames and category paths", () => {
    expect(backupFilename(date)).toBe("maktaba-railway-full-2026-07-22_03-04-05Z.dump");
    expect(backupObjectPath("daily", date)).toBe("daily/2026/07/maktaba-railway-full-2026-07-22_03-04-05Z.dump");
    expect(backupObjectPath("weekly", date)).toBe("weekly/2026/maktaba-railway-weekly-2026-07-22_03-04-05Z.dump");
    expect(backupObjectPath("monthly", date)).toBe("monthly/2026/maktaba-railway-monthly-2026-07-22_03-04-05Z.dump");
  });
  it("creates a safe manifest without secrets", () => {
    const manifest = createManifest({ filename: backupFilename(date), createdAt: date.toISOString(), sourceLabel: "railway-production", serverVersion: "18.4", pgDumpVersion: "pg_dump 18.4", sizeBytes: 123, sha256: "ABC", environment: "production", retentionCategory: "daily", workerVersion: "1" });
    expect(manifest).toMatchObject({ format: "postgresql-custom", restoreListVerified: true, sizeBytes: 123 });
    expect(JSON.stringify(manifest)).not.toMatch(/DATABASE_URL|service.role|password|postgresql:\/\//i);
  });
  it.each([["daily", 7], ["weekly", 4], ["monthly", 6]] as const)("keeps the configured newest %s backups", (category, keep) => {
    const objects = Array.from({ length: keep + 3 }, (_, index) => ({ name: `${category}/2026/file-${String(index).padStart(2, "0")}.dump`, createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z` }));
    const deleted = retentionDeletes(objects, category, keep);
    expect(deleted.filter((name) => name.endsWith(".dump"))).toHaveLength(3);
    expect(deleted.filter((name) => name.endsWith(".json"))).toHaveLength(3);
  });
  it("never deletes another category and pairs an expired manifest", () => {
    const objects = [{ name: "daily/2026/old.dump", createdAt: "2025-01-01" }, { name: "weekly/2026/keep.dump", createdAt: "2024-01-01" }];
    expect(retentionDeletes(objects, "daily", 0)).toEqual(["daily/2026/old.dump", "daily/2026/old.json"]);
  });
  it("selects daily, configured weekly and first monthly copies", () => {
    expect(categoriesFor(new Date("2026-07-19T03:00:00Z"), false, 0)).toEqual(["daily", "weekly", "monthly"]);
    expect(categoriesFor(date, true, 0)).toEqual(["daily"]);
  });
  it("masks connection strings and credential headers in errors", () => {
    const result = sanitizeError("failed postgresql://user:secret@host/db password=hunter2 authorization: bearer-secret");
    expect(result).not.toContain("secret"); expect(result).not.toContain("hunter2"); expect(result).toContain("REDACTED");
  });
  it("derives the matching manifest path", () => expect(manifestPath("daily/a.dump")).toBe("daily/a.json"));
  it("rejects empty dumps and unsupported pg_dump clients", () => {
    expect(() => assertNonEmptyDump(0)).toThrow("vide");
    expect(() => assertSupportedPgDumpVersion("pg_dump (PostgreSQL) 17.6")).toThrow("18");
    expect(() => assertSupportedPgDumpVersion("pg_dump (PostgreSQL) 18.4")).not.toThrow();
  });
});
