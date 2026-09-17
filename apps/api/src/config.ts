import "dotenv/config";
import { z } from "zod";

/** Only safe for local dev; production is forced to override it (see below). */
const CUSTOMER_APP_URL_DEV_DEFAULT = "http://localhost:3000";
const KDS_APP_URL_DEV_DEFAULT = "http://localhost:3002";

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
  /** Public origin of the customer app — the QR encodes `<this>/order?t=<token>`
   *  (PRD 4.1.2). Printed onto physical cards, so production must set it. */
  CUSTOMER_APP_URL: z.string().url().default(CUSTOMER_APP_URL_DEV_DEFAULT),
  /** Public origin of the kitchen display app — the provisioning QR encodes
   *  `<this>/?d=<deviceId>&t=<token>` (Auth_RBAC_Spec §4). Production must set
   *  it: a wrong origin makes every enrolment QR unusable. */
  KDS_APP_URL: z.string().url().default(KDS_APP_URL_DEV_DEFAULT),

  // ── External services ──────────────────────────────────────────────────────
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  MIDTRANS_IS_PRODUCTION: z.coerce.boolean().default(false),
  CLOUDINARY_URL: z.string().default(""),
});

const result = envSchema
  .superRefine((env, ctx) => {
    // A wrong value here ships as unscannable printed QR codes, so it cannot be
    // allowed to fall back silently in production.
    if (
      env.NODE_ENV === "production" &&
      env.CUSTOMER_APP_URL === CUSTOMER_APP_URL_DEV_DEFAULT
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CUSTOMER_APP_URL"],
        message:
          "must be set to the public customer app origin in production (QR codes embed it)",
      });
    }

    // Same reasoning for the KDS enrolment QR — it embeds this origin.
    if (
      env.NODE_ENV === "production" &&
      env.KDS_APP_URL === KDS_APP_URL_DEV_DEFAULT
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KDS_APP_URL"],
        message:
          "must be set to the public KDS app origin in production (provisioning QR codes embed it)",
      });
    }

    if (env.MIDTRANS_IS_PRODUCTION && !env.MIDTRANS_SERVER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MIDTRANS_SERVER_KEY"],
        message: "must be set when MIDTRANS_IS_PRODUCTION is true",
      });
    }
  })
  .safeParse(process.env);

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
