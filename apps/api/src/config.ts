import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_PEPPER: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.string().default("info"),
});
export const config = schema.parse(process.env);
