import { describe, it, expect } from "vitest";
import { checkDemoMidtrans, config, parseDemoStaffEmails } from "../config.js";

const SANDBOX_KEY = "SB-Mid-server-abc123";

describe("checkDemoMidtrans", () => {
  it("accepts a sandbox setup in Demo Mode", () => {
    expect(
      checkDemoMidtrans({ DEMO_MODE: true, MIDTRANS_IS_PRODUCTION: false, MIDTRANS_SERVER_KEY: SANDBOX_KEY }),
    ).toEqual([]);
  });

  it("refuses production mode in Demo Mode", () => {
    const problems = checkDemoMidtrans({
      DEMO_MODE: true,
      MIDTRANS_IS_PRODUCTION: true,
      MIDTRANS_SERVER_KEY: SANDBOX_KEY,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("MIDTRANS_IS_PRODUCTION=false");
  });

  it("refuses a production or missing server key in Demo Mode", () => {
    for (const key of ["Mid-server-live-key", ""]) {
      const problems = checkDemoMidtrans({
        DEMO_MODE: true,
        MIDTRANS_IS_PRODUCTION: false,
        MIDTRANS_SERVER_KEY: key,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("sandbox server key");
    }
  });

  it("DEMO_MODE off: no new requirement on Midtrans at all", () => {
    expect(
      checkDemoMidtrans({ DEMO_MODE: false, MIDTRANS_IS_PRODUCTION: true, MIDTRANS_SERVER_KEY: "Mid-server-live" }),
    ).toEqual([]);
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
