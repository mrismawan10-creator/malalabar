import { describe, it, expect } from "vitest";
import {
  checkDemoMidtrans,
  checkTrustProxyHops,
  config,
  parseDemoStaffEmails,
} from "../config.js";
import { isSandboxMidtransUrl, midtransBaseUrls } from "../lib/midtrans-urls.js";

const SANDBOX_KEY = "SB-Mid-server-abc123";

describe("checkDemoMidtrans", () => {
  const demo = (over: Partial<{ MIDTRANS_IS_PRODUCTION: boolean; MIDTRANS_SERVER_KEY: string }>) =>
    checkDemoMidtrans({
      DEMO_MODE: true,
      MIDTRANS_IS_PRODUCTION: false,
      MIDTRANS_SERVER_KEY: SANDBOX_KEY,
      ...over,
    });

  it("accepts a sandbox setup in Demo Mode, with no warnings (happy path)", () => {
    expect(demo({})).toEqual({ errors: [], warnings: [] });
  });

  it("refuses production mode: flag and the production hosts it selects (failure path)", () => {
    const { errors } = demo({ MIDTRANS_IS_PRODUCTION: true });
    expect(errors[0]).toContain("MIDTRANS_IS_PRODUCTION=false");
    expect(errors.some((e) => e.includes("snap API") && e.includes("app.midtrans.com"))).toBe(true);
    expect(errors.some((e) => e.includes("core API") && e.includes("api.midtrans.com"))).toBe(true);
  });

  it("only warns about a key without the sandbox prefix — it does not refuse", () => {
    for (const key of ["Mid-server-live-key", ""]) {
      const { errors, warnings } = demo({ MIDTRANS_SERVER_KEY: key });
      expect(errors).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("SB-Mid-server-");
    }
  });

  it("DEMO_MODE off: no new requirement or warning at all", () => {
    expect(
      checkDemoMidtrans({ DEMO_MODE: false, MIDTRANS_IS_PRODUCTION: true, MIDTRANS_SERVER_KEY: "Mid-server-live" }),
    ).toEqual({ errors: [], warnings: [] });
  });
});

describe("midtrans base URLs", () => {
  it("maps the flag to sandbox or production hosts", () => {
    const sandbox = midtransBaseUrls(false);
    const production = midtransBaseUrls(true);
    expect(isSandboxMidtransUrl(sandbox.snap) && isSandboxMidtransUrl(sandbox.core)).toBe(true);
    expect(isSandboxMidtransUrl(production.snap) || isSandboxMidtransUrl(production.core)).toBe(false);
  });

  it("recognises only https sandbox hosts", () => {
    expect(isSandboxMidtransUrl("https://app.sandbox.midtrans.com/snap/v1")).toBe(true);
    expect(isSandboxMidtransUrl("http://app.sandbox.midtrans.com/snap/v1")).toBe(false);
    expect(isSandboxMidtransUrl("https://sandbox.midtrans.com.evil.example/")).toBe(false);
    expect(isSandboxMidtransUrl("https://app.midtrans.com/snap/v1")).toBe(false);
    expect(isSandboxMidtransUrl("not a url")).toBe(false);
  });
});

describe("demo config defaults", () => {
  it("Demo Mode is off and Midtrans is sandbox when the env does not say otherwise", () => {
    expect(config.DEMO_MODE).toBe(false);
    expect(config.MIDTRANS_IS_PRODUCTION).toBe(false);
    expect(config.DEMO_AI_DAILY_LIMIT).toBe(20);
  });

  it("parses DEMO_STAFF_EMAILS into trimmed lower-case entries", () => {
    expect(parseDemoStaffEmails(" Demo@x.id, ,b@y.id ")).toEqual(["demo@x.id", "b@y.id"]);
    expect(parseDemoStaffEmails("")).toEqual([]);
  });
});

describe("TRUST_PROXY_HOPS", () => {
  it("must be stated explicitly in production (failure path)", () => {
    expect(checkTrustProxyHops({ NODE_ENV: "production" })).toContain("must be set in production");
  });

  it("accepts any explicit value in production, including 0", () => {
    expect(checkTrustProxyHops({ NODE_ENV: "production", TRUST_PROXY_HOPS: 1 })).toBeNull();
    expect(checkTrustProxyHops({ NODE_ENV: "production", TRUST_PROXY_HOPS: 0 })).toBeNull();
  });

  it("defaults to 0 (header ignored) outside production", () => {
    expect(checkTrustProxyHops({ NODE_ENV: "development" })).toBeNull();
    expect(config.TRUST_PROXY_HOPS).toBe(0);
  });
});

describe("CLIENT_IP_HEADER", () => {
  it("is unset by default (no behaviour change)", () => {
    expect(config.CLIENT_IP_HEADER).toBeUndefined();
  });
});
