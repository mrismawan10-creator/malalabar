import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Opaque, signed, revocable table tokens — CLAUDE.md hard rule 6.
 *
 * Format: `<nonce>.<signature>` (both base64url).
 *  - `nonce` is 32 random bytes. It carries NO table number, id or version —
 *    the value is meaningless on its own, so a QR reveals nothing about the
 *    table it belongs to and cannot be enumerated.
 *  - `signature` is HMAC-SHA256 over the nonce, domain-separated so a table
 *    token can never be replayed as any other token kind.
 *
 * Why sign at all when the nonce is already a unique DB lookup key: it lets
 * `POST /sessions` (T1.3) distinguish three cases the contract needs to tell
 * apart (API_Contract §2) without keeping a graveyard of dead tokens —
 *
 *   invalid signature      → garbage / hand-typed junk        → 400
 *   valid signature, no DB row → a real QR that was regenerated → 409 stale
 *   valid signature, row found, table inactive                 → 409 inactive
 *
 * Revocation is rotation: `POST /admin/tables/:id/qr/regenerate` overwrites
 * `qrToken` and bumps `tokenVersion`, so the previous value stops resolving
 * immediately.
 *
 * Key: `JWT_SECRET`. Env_Reference §1 defines no separate table-token secret,
 * so this reuses it rather than inventing an undocumented env var; the domain
 * prefix keeps the two uses cryptographically distinct.
 */

const DOMAIN = "qr-table-token:v1";

function sign(nonce: string): string {
  return createHmac("sha256", config.JWT_SECRET)
    .update(`${DOMAIN}:${nonce}`)
    .digest("base64url");
}

/** Mint a fresh table token. Never derived from the table's identity. */
export function mintTableToken(): string {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

/**
 * True when `token` was minted by this server. Says nothing about whether the
 * token is still current — that is a DB lookup (T1.3).
 */
export function hasValidTableTokenSignature(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [nonce, signature] = parts;
  if (!nonce || !signature) return false;

  const expected = Buffer.from(sign(nonce));
  const actual = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch, so check first.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
