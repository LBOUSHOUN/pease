import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "../config.js";
export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  onnotice: config.NODE_ENV === "test" ? () => undefined : undefined,
});
export const db = drizzle(sql);
