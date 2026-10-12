import "dotenv/config";
import { z } from "zod";
import { isSandboxMidtransUrl, midtransBaseUrls } from "./lib/midtrans-urls.js";

/** Only safe for local dev; production is forced to override it (see below). */
const CUSTOMER_APP_URL_DEV_DEFAULT = "http://localhost:3000";
const KDS_APP_URL_DEV_DEFAULT = "http://localhost:3002";

/** Prefix many Midtrans sandbox server keys carry. Some sandbox accounts issue
 *  keys without it, so its absence is a hint to double-check, never proof of
 *  a production key. */
const MIDTRANS_SANDBOX_SERVER_KEY_PREFIX = "SB-Mid-server-";

/**
 * Strict boolean env flag. `z.coerce.boolean()` turns the string "false" into
 * `true` (any non-empty string is truthy), which silently flipped
 * MIDTRANS_IS_PRODUCTION on for anyone who wrote `false` as the docs say.
 */
const envFlag = z
  .preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(["true", "false", "1", "0", ""]).default("false"),
  )
  .transform((v) => v === "true" || v === "1");

/**
 * Too high and clients can spoof their IP past the rate limits; too low and
 * every client shares the proxy's bucket. No default is safe in production,
 * so it must be stated (Deployment.md).
 */
export function checkTrustProxyHops(env: {
  NODE_ENV: string;
  TRUST_PROXY_HOPS?: number;
}): string | null {
  return env.NODE_ENV === "production" && env.TRUST_PROXY_HOPS === undefined
    ? "must be set in production to the number of proxies in front of the API (Deployment.md)"
    : null;
}

export interface DemoMidtransEnv {
  DEMO_MODE: boolean;
  MIDTRANS_IS_PRODUCTION: boolean;
  MIDTRANS_SERVER_KEY: string;
}

export interface DemoMidtransCheck {
  /** Startup is refused. */
  errors: string[];
  /** Logged at startup; the API still starts. */
  warnings: string[];
}

/**
 * Demo Mode must never be able to move real money (docs/Demo_Mode.md).
 *
 * Refuses startup on what decides where requests go: the production flag and
 * the base URLs the payment service will call (lib/midtrans-urls.ts). Today the
 * URLs follow the flag, so the URL check is a backstop for the day they become
 * configurable. The key prefix is only a hint — key formats are Midtrans'
 * business — so a non-sandbox-looking key is a warning, not a refusal.
 *
 * Empty when Demo Mode is off (no behaviour change outside demo).
 */
export function checkDemoMidtrans(env: DemoMidtransEnv): DemoMidtransCheck {
  const result: DemoMidtransCheck = { errors: [], warnings: [] };
  if (!env.DEMO_MODE) return result;

  if (env.MIDTRANS_IS_PRODUCTION) {
    result.errors.push(
      "DEMO_MODE=true requires MIDTRANS_IS_PRODUCTION=false (sandbox only)",
    );
  }
  const urls = midtransBaseUrls(env.MIDTRANS_IS_PRODUCTION);
  for (const [name, url] of Object.entries(urls)) {
    if (!isSandboxMidtransUrl(url)) {
      result.errors.push(
        `DEMO_MODE=true requires the Midtrans ${name} API to be the sandbox host (got ${url})`,
      );
    }
  }
  if (!env.MIDTRANS_SERVER_KEY.startsWith(MIDTRANS_SANDBOX_SERVER_KEY_PREFIX)) {
    result.warnings.push(
      `MIDTRANS_SERVER_KEY has no ${MIDTRANS_SANDBOX_SERVER_KEY_PREFIX} prefix. That alone ` +
        "does not make it a production key (some sandbox accounts issue keys without it), " +
        "but confirm it comes from the sandbox dashboard: the sandbox API answers 401 to a " +
        "key from the other environment (docs/Deployment.md).",
    );
  }
  return result;
}

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
  /** Reverse proxies in front of the API whose X-Forwarded-For entries are
   *  trusted (Fastify `trustProxy`). 0 = use the socket address, ignore the
   *  header. Must be set explicitly in production — see Deployment.md. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),

  // ── External services ──────────────────────────────────────────────────────
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  MIDTRANS_IS_PRODUCTION: envFlag,
  CLOUDINARY_URL: z.string().default(""),

  // ── Demo Mode (docs/Demo_Mode.md) — all inert unless DEMO_MODE=true ───────
  DEMO_MODE: envFlag,
  /** Comma-separated shared demo accounts (<cashier>,<admin>) — lib/demo-policy. */
  DEMO_STAFF_EMAILS: z.string().default(""),
  /** Read only by the demo scripts to (re)set the demo account's password. */
  DEMO_STAFF_PASSWORD: z.string().default(""),
  DEMO_AI_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
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

    const trustProxyIssue = checkTrustProxyHops(env);
    if (trustProxyIssue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TRUST_PROXY_HOPS"],
        message: trustProxyIssue,
      });
    }

    if (env.MIDTRANS_IS_PRODUCTION && !env.MIDTRANS_SERVER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MIDTRANS_SERVER_KEY"],
        message: "must be set when MIDTRANS_IS_PRODUCTION is true",
      });
    }

    for (const message of checkDemoMidtrans(env).errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_MODE"],
        message,
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

export const config = {
  ...result.data,
  TRUST_PROXY_HOPS: result.data.TRUST_PROXY_HOPS ?? 0,
};

for (const warning of checkDemoMidtrans(config).warnings) {
  // eslint-disable-next-line no-console
  console.warn(`[config] Demo Mode: ${warning}`);
}

/** Lower-cased, trimmed DEMO_STAFF_EMAILS entries. */
export function parseDemoStaffEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
export type Config = typeof config;
