import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // ── Required ───────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  // ── Optional with defaults ─────────────────────────────────────────────────
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
  KDS_TOKEN_TTL: z.string().default("90d"),
  SESSION_TIMEOUT_DEFAULT_MINS: z.coerce.number().int().positive().default(90),
  RECONCILE_PENDING_AFTER_MINS: z.coerce.number().int().positive().default(15),
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:3000,http://localhost:3001,http://localhost:3002",
    ),

  // ── External services ──────────────────────────────────────────────────────
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  MIDTRANS_IS_PRODUCTION: z.coerce.boolean().default(false),
  CLOUDINARY_URL: z.string().default(""),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const errors = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`\n[config] Missing or invalid environment variables:\n${errors}\n`);
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;
