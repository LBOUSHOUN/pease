import { createHash } from "node:crypto";

export type BackupCategory = "daily" | "weekly" | "monthly";
export type StoredObject = { name: string; createdAt?: string };
export type BackupManifest = {
  filename: string;
  createdAt: string;
  sourceLabel: string;
  serverVersion: string;
  pgDumpVersion: string;
  sizeBytes: number;
  sha256: string;
  format: "postgresql-custom";
  compression: "pg_dump-custom";
  restoreListVerified: true;
  environment: string;
  retentionCategory: BackupCategory;
  workerVersion: string;
};

const stamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z").replace("T", "_").replace(/:/g, "-");
export function backupFilename(date: Date, category: BackupCategory = "daily") {
  const label = category === "daily" ? "full" : category;
  return `maktaba-railway-${label}-${stamp(date)}.dump`;
}
export function backupObjectPath(category: BackupCategory, date: Date, filename = backupFilename(date, category)) {
  const year = String(date.getUTCFullYear()), month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return category === "daily" ? `daily/${year}/${month}/${filename}` : `${category}/${year}/${filename}`;
}
export const manifestPath = (dumpPath: string) => dumpPath.replace(/\.dump$/, ".json");
export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex").toUpperCase();

export function createManifest(input: Omit<BackupManifest, "format" | "compression" | "restoreListVerified">): BackupManifest {
  return { ...input, format: "postgresql-custom", compression: "pg_dump-custom", restoreListVerified: true };
}

export function retentionDeletes(objects: StoredObject[], category: BackupCategory, keep: number) {
  const prefix = `${category}/`;
  const dumps = objects
    .filter((object) => object.name.startsWith(prefix) && object.name.endsWith(".dump"))
    .sort((a, b) => (b.createdAt ?? b.name).localeCompare(a.createdAt ?? a.name));
  return dumps.slice(Math.max(0, keep)).flatMap((dump) => [dump.name, manifestPath(dump.name)]);
}

export function sanitizeError(value: unknown) {
  let message = value instanceof Error ? value.message : String(value);
  message = message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL REDACTED]")
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|apikey|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/(password=)[^\s]+/gi, "$1[REDACTED]");
  return message.slice(0, 1_000);
}

export function categoriesFor(date: Date, monthlyExists: boolean, weeklyDay = 0): BackupCategory[] {
  const result: BackupCategory[] = ["daily"];
  if (date.getUTCDay() === weeklyDay) result.push("weekly");
  if (!monthlyExists) result.push("monthly");
  return result;
}

export function assertSupportedPgDumpVersion(versionOutput: string) {
  const major = Number(versionOutput.match(/(\d+)(?:\.\d+)?/)?.[1] ?? 0);
  if (major < 18) throw new Error(`pg_dump 18 ou plus récent requis; version détectée: ${versionOutput}`);
}

export function assertNonEmptyDump(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Le dump généré est vide.");
}
