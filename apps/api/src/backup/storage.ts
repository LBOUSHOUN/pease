import { readFile } from "node:fs/promises";
import type { StoredObject } from "./core.js";

type Listed = { name: string; id?: string | null; created_at?: string; metadata?: unknown };
export class SupabaseBackupStorage {
  constructor(private readonly url: string, private readonly key: string, readonly bucket: string) {}
  private async call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/storage/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.key}`, apikey: this.key, ...init.headers },
    });
    if (!response.ok) throw new Error(`Supabase Storage ${response.status}: ${await response.text()}`);
    return response;
  }
  async assertPrivateBucket() {
    const bucket = await (await this.call(`/bucket/${encodeURIComponent(this.bucket)}`)).json() as { public?: boolean };
    if (bucket.public !== false) throw new Error(`Le bucket ${this.bucket} doit exister et rester privé.`);
  }
  async upload(path: string, source: string | Buffer, contentType: string) {
    const body = typeof source === "string" ? await readFile(source) : source;
    const uploadBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    await this.call(`/object/${encodeURIComponent(this.bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST", headers: { "content-type": contentType, "x-upsert": "false" }, body: uploadBody,
    });
  }
  async remove(paths: string[]) {
    if (!paths.length) return;
    await this.call(`/object/${encodeURIComponent(this.bucket)}`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }),
    });
  }
  async listRecursive(root: string): Promise<StoredObject[]> {
    const output: StoredObject[] = [];
    const walk = async (prefix: string): Promise<void> => {
      let offset = 0;
      while (true) {
        const rows = await (await this.call(`/object/list/${encodeURIComponent(this.bucket)}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
        })).json() as Listed[];
        for (const row of rows) {
          const path = prefix ? `${prefix}/${row.name}` : row.name;
          if (row.id == null && row.metadata == null) await walk(path);
          else output.push({ name: path, createdAt: row.created_at });
        }
        if (rows.length < 100) break;
        offset += rows.length;
      }
    };
    await walk(root.replace(/\/$/, ""));
    return output;
  }
  async exists(path: string) {
    const slash = path.lastIndexOf("/"), prefix = path.slice(0, slash), filename = path.slice(slash + 1);
    const rows = await (await this.call(`/object/list/${encodeURIComponent(this.bucket)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1, search: filename }),
    })).json() as Listed[];
    return rows.some((row) => row.name === filename);
  }
}
