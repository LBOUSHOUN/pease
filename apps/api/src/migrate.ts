import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./db/index.js";
await migrate(db, { migrationsFolder: "./drizzle" });
await sql.end();
console.log("Migrations appliquées");
