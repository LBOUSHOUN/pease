import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  override: false,
  quiet: true,
});
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_PEPPER: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.string().default("info"),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(8),
});
export const config = schema.parse({
  ...process.env,
  API_HOST: process.env.API_HOST ?? "0.0.0.0",
  API_PORT: process.env.PORT ?? process.env.API_PORT ?? "3000",
});

