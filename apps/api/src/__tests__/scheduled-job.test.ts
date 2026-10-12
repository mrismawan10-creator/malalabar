import { describe, it, expect, vi, afterEach } from "vitest";
import { startScheduledJob } from "../lib/scheduled-job.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startScheduledJob", () => {
  it("awaitFirstRun: resolves only after the first run has finished (happy path)", async () => {
    let finished = false;
    const job = await startScheduledJob({
      name: "sweep",
      intervalMs: 60_000,
      log: vi.fn(),
      awaitFirstRun: true,
      runOnce: async () => {
        await new Promise((r) => setTimeout(r, 20));
        finished = true;
      },
    });
    expect(finished).toBe(true);
    job.stop();
  });

  it("without awaitFirstRun: starts the first run but does not wait for it", async () => {
    let release!: () => void;
    const runOnce = vi.fn(() => new Promise<void>((r) => (release = r)));
    const job = await startScheduledJob({ name: "reconcile", intervalMs: 60_000, log: vi.fn(), runOnce });
    expect(runOnce).toHaveBeenCalledTimes(1);
    release();
    job.stop();
  });

  it("logs a failing first run instead of failing boot (failure path)", async () => {
    const log = vi.fn();
    const job = await startScheduledJob({
      name: "sweep",
      intervalMs: 60_000,
      log,
      awaitFirstRun: true,
      runOnce: () => Promise.reject(new Error("db down")),
    });
    expect(log).toHaveBeenCalledWith("sweep failed", expect.objectContaining({ message: "db down" }));
    job.stop();
  });

  it("repeats on the interval, survives a failing run, and stops", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const runOnce = vi
      .fn<[], Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(undefined);

    const job = await startScheduledJob({ name: "sweep", intervalMs: 1000, log, runOnce, awaitFirstRun: true });
    expect(runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(3);

    job.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});
