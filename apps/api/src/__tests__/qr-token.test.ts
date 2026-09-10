import { describe, it, expect } from "vitest";
import {
  hasValidTableTokenSignature,
  mintTableToken,
} from "../lib/qr-token.js";

describe("qr table token — CLAUDE.md hard rule 6", () => {
  it("mints a token that verifies (happy path)", () => {
    const token = mintTableToken();
    expect(hasValidTableTokenSignature(token)).toBe(true);
  });

  it("mints a distinct token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintTableToken()));
    expect(tokens.size).toBe(50);
  });

  it("is opaque — carries no table number, id or version", () => {
    const token = mintTableToken();
    const [nonce] = token.split(".");
    // 32 random bytes, base64url, no padding.
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects a tampered signature (failure path)", () => {
    const token = mintTableToken();
    const [nonce, sig] = token.split(".");
    const flipped = sig!.startsWith("A") ? `B${sig!.slice(1)}` : `A${sig!.slice(1)}`;
    expect(hasValidTableTokenSignature(`${nonce}.${flipped}`)).toBe(false);
  });

  it("rejects a swapped nonce (failure path)", () => {
    const [, sigA] = mintTableToken().split(".");
    const [nonceB] = mintTableToken().split(".");
    expect(hasValidTableTokenSignature(`${nonceB}.${sigA}`)).toBe(false);
  });

  it("rejects malformed input without throwing (failure path)", () => {
    for (const bad of ["", "no-dot", "a.b.c", ".", "abc.", ".abc"]) {
      expect(hasValidTableTokenSignature(bad)).toBe(false);
    }
  });
});
