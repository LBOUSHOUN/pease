import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { assertNonEmptyDump, assertSupportedPgDumpVersion, backupFilename, backupObjectPath, categoriesFor, createManifest, manifestPath, retentionDeletes, sanitizeError, sha256, type BackupCategory } from "./core.js";
import { SupabaseBackupStorage } from "./storage.js";

const execFile = promisify(execFileCallback), LOCK_ID = 4_891_027_041;
const log = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquant.`);
  return value;
};
const command = async (file: string, args: string[], env?: NodeJS.ProcessEnv) => {
  try { return await execFile(file, args, { env, maxBuffer: 10 * 1024 * 1024 }); }
  catch (error) { throw new Error(`${file} a échoué: ${sanitizeError(error)}`); }
};
const postgresEnvironment = (databaseUrl: string) => {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE,
  };
};

export async function runBackup() {
  if (process.env.BACKUP_ENABLED === "false") return log("info", "backup_disabled");
  const started = Date.now(), databaseUrl = required("DATABASE_URL"), supabaseUrl = required("SUPABASE_URL"),
    serviceKey = required("SUPABASE_SERVICE_ROLE_KEY"), bucket = process.env.SUPABASE_BACKUP_BUCKET || "double-backups",
    pgDump = process.env.PG_DUMP_PATH || "pg_dump", sourceLabel = process.env.BACKUP_SOURCE_LABEL || "railway-production";
  const pgRestore = process.env.PG_RESTORE_PATH || "pg_restore";
  const version = (await command(pgDump, ["--version"])).stdout.trim();
  assertSupportedPgDumpVersion(version);
  log("info", "backup_start", { sourceLabel, pgDumpVersion: version });
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  const connection = await sql.reserve();
  let locked = false, directory: string | undefined;
  try {
    const [lock] = await connection<{ acquired: boolean }[]>`select pg_try_advisory_lock(${LOCK_ID}) as acquired`;
    if (!lock?.acquired) return log("info", "backup_already_running");
    locked = true;
    const storage = new SupabaseBackupStorage(supabaseUrl, serviceKey, bucket);
    await storage.assertPrivateBucket();
    const now = new Date(), filename = backupFilename(now), tempRoot = process.env.BACKUP_TEMP_DIRECTORY || tmpdir();
    directory = await mkdtemp(join(tempRoot, "double-library-backup-"));
    const dumpFile = join(directory, filename);
    await command(pgDump, ["--format=custom", "--compress=gzip:6", "--no-owner", "--no-acl", "--file", dumpFile], postgresEnvironment(databaseUrl));
    const info = await stat(dumpFile);
    if (!info.isFile()) throw new Error("Le dump généré est introuvable.");
    assertNonEmptyDump(info.size);
    await command(pgRestore, ["--list", dumpFile]);
    const data = await readFile(dumpFile), checksum = sha256(data);
    const [server] = await connection<{ version: string }[]>`show server_version`;
    const monthlyPrefix = `monthly/${now.getUTCFullYear()}`;
    const monthlyExists = (await storage.listRecursive(monthlyPrefix)).some((item) => item.name.includes(`-${now.toISOString().slice(0, 7)}-`) && item.name.endsWith(".dump"));
    const weeklyDay = Number(process.env.BACKUP_WEEKLY_DAY ?? "0");
    const categories = categoriesFor(now, monthlyExists, weeklyDay);
    for (const category of categories) {
      const categoryFilename = backupFilename(now, category), objectPath = backupObjectPath(category, now, categoryFilename);
      const manifest = createManifest({ filename: categoryFilename, createdAt: now.toISOString(), sourceLabel,
        serverVersion: server?.version ?? "unknown", pgDumpVersion: version, sizeBytes: info.size, sha256: checksum,
        environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "production", retentionCategory: category,
        workerVersion: process.env.npm_package_version || "0.1.0" });
      await storage.upload(objectPath, dumpFile, "application/octet-stream");
      await storage.upload(manifestPath(objectPath), Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");
      if (!await storage.exists(objectPath) || !await storage.exists(manifestPath(objectPath))) throw new Error(`Confirmation d’upload impossible: ${objectPath}`);
      log("info", "backup_uploaded", { objectPath, sizeBytes: info.size, sha256Verified: true, restoreListVerified: true });
    }
    for (const [category, keep] of Object.entries({ daily: Number(process.env.BACKUP_RETENTION_DAILY ?? 7), weekly: Number(process.env.BACKUP_RETENTION_WEEKLY ?? 4), monthly: Number(process.env.BACKUP_RETENTION_MONTHLY ?? 6) }) as [BackupCategory, number][]) {
      try {
        const objects = await storage.listRecursive(category), deletions = retentionDeletes(objects, category, keep);
        await storage.remove(deletions);
        log("info", "retention_complete", { category, retained: Math.min(keep, objects.filter((o) => o.name.endsWith(".dump")).length), deleted: deletions.filter((p) => p.endsWith(".dump")) });
      } catch (error) { log("warn", "retention_failed", { category, reason: sanitizeError(error) }); }
    }
    log("info", "backup_success", { durationMs: Date.now() - started, filename, categories });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch((error) => log("warn", "temporary_cleanup_failed", { reason: sanitizeError(error) }));
    if (locked) await connection`select pg_advisory_unlock(${LOCK_ID})`.catch(() => undefined);
    connection.release(); await sql.end();
  }
}

export async function verifyRowCounts() {
  const sourceUrl = required("DATABASE_URL"), targetUrl = required("BACKUP_VERIFY_DATABASE_URL");
  const tables = (process.env.BACKUP_VERIFY_TABLES || "products,sales,customers,app_settings,users,categories").split(",").map((v) => v.trim()).filter((v) => /^[a-z_][a-z0-9_]*$/.test(v));
  const source = postgres(sourceUrl, { max: 1 }), target = postgres(targetUrl, { max: 1 });
  try {
    let mismatch = false;
    for (const table of tables) {
      const [a] = await source.unsafe<{ count: string }[]>(`select count(*)::text as count from "${table}"`), [b] = await target.unsafe<{ count: string }[]>(`select count(*)::text as count from "${table}"`);
      const matches = a?.count === b?.count; mismatch ||= !matches; log("info", "row_count", { table, source: a?.count, target: b?.count, matches });
    }
    if (mismatch) throw new Error("Les nombres de lignes diffèrent.");
  } finally { await Promise.all([source.end(), target.end()]); }
}

export async function runRetentionOnly() {
  const storage = new SupabaseBackupStorage(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), process.env.SUPABASE_BACKUP_BUCKET || "double-backups");
  await storage.assertPrivateBucket();
  for (const [category, keep] of Object.entries({ daily: Number(process.env.BACKUP_RETENTION_DAILY ?? 7), weekly: Number(process.env.BACKUP_RETENTION_WEEKLY ?? 4), monthly: Number(process.env.BACKUP_RETENTION_MONTHLY ?? 6) }) as [BackupCategory, number][]) {
    await storage.remove(retentionDeletes(await storage.listRecursive(category), category, keep));
  }
}

const mode = process.argv[2] || "run";
const action = mode === "verify" ? verifyRowCounts : mode === "retention" ? runRetentionOnly : runBackup;
action().catch((error) => { log("error", "backup_failed", { reason: sanitizeError(error) }); process.exitCode = 1; });
