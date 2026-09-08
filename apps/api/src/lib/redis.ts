import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "../config.js";

/**
 * Redis is a cache and coordination layer, never the source of truth for money
 * or order content (SDD_Core §5). Everything here degrades safely: if Redis is
 * unreachable, callers fall back to the database guarantee.
 */

let client: Redis | undefined;
let connectionErrorLogged = false;

export function getRedis(): Redis {
  if (client) return client;

  client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    // Fail fast instead of queueing forever when Redis is down — the DB
    // backstop is what actually guarantees correctness.
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  // An EventEmitter with no "error" listener throws on error, which would take
  // the process down over a cache outage. Log the first failure, then stay
  // quiet so a reconnect loop cannot flood the logs.
  client.on("error", (err: Error) => {
    if (connectionErrorLogged) return;
    connectionErrorLogged = true;
    // eslint-disable-next-line no-console
    console.error(
      `[redis] unavailable (${err.message}) — falling back to database guarantees`,
    );
  });
  client.on("ready", () => {
    connectionErrorLogged = false;
  });

  return client;
}

export async function disconnectRedis(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = undefined;
}

/** Releases only if we still hold the lock, so a slow holder cannot free someone else's. */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface Lock {
  release(): Promise<void>;
}

/**
 * Best-effort mutex. Returns null when the lock is held by someone else, or
 * when Redis itself is unavailable — callers must stay correct in both cases.
 */
export async function acquireLock(
  key: string,
  ttlMs: number,
): Promise<Lock | null> {
  const token = randomUUID();
  const redis = getRedis();

  let acquired: string | null;
  try {
    acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  } catch {
    // Redis down: report "not acquired" so the caller proceeds on the DB guard.
    return null;
  }
  if (acquired !== "OK") return null;

  return {
    async release() {
      try {
        await redis.eval(RELEASE_SCRIPT, 1, key, token);
      } catch {
        // Lock expires on its own via the TTL.
      }
    },
  };
}

/** Lock key for the one-OPEN-session-per-table invariant (SDD_Core §5.1). */
export function tableSessionLockKey(tableId: string): string {
  return `table:${tableId}:session`;
}
