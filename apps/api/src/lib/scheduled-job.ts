/**
 * In-process periodic job (session timeout sweep, payment reconciliation).
 *
 * `awaitFirstRun` matters on hosts that sleep when idle (Render free): the
 * request that wakes the server arrives the moment it listens, so a first run
 * that must finish before serving — closing sessions that timed out while the
 * server slept — has to be awaited during boot rather than raced.
 *
 * A failing run is logged and never thrown: a job must not take boot or the
 * process down with it.
 */
export interface ScheduledJobOptions {
  name: string;
  runOnce: () => Promise<unknown>;
  intervalMs: number;
  log: (message: string, err: unknown) => void;
  /** Finish the first run before resolving. Default: fire and forget. */
  awaitFirstRun?: boolean;
}

export interface ScheduledJob {
  stop(): void;
}

export async function startScheduledJob(
  options: ScheduledJobOptions,
): Promise<ScheduledJob> {
  const run = () =>
    options.runOnce().then(
      () => undefined,
      (err: unknown) => options.log(`${options.name} failed`, err),
    );

  const timer = setInterval(() => void run(), options.intervalMs);
  timer.unref?.();

  if (options.awaitFirstRun) {
    await run();
  } else {
    void run();
  }

  return { stop: () => clearInterval(timer) };
}
