import { createApiClient } from "@malalabar/ui";
import { config } from "@/config";

async function getHealth() {
  try {
    const api = createApiClient(config.apiBaseUrl);
    return await api.health({ cache: "no-store" });
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="bg-surface-raised border-3 border-ink-line shadow-hard-md rounded-2xl p-6 text-center max-w-xs w-full">
        <h1 className="font-display text-2xl text-ink mb-2">Malalabar</h1>
        <p className="font-ui text-base text-ink-soft mb-4">
          Scan · Pesan · Nikmati
        </p>
        <div
          className={`rounded-lg px-3 py-2 text-sm font-ui ${
            health
              ? "bg-success/10 text-success-ink"
              : "bg-danger/10 text-danger-ink"
          }`}
        >
          API: {health ? `✓ ${health.status}` : "✗ unreachable"}
        </div>
      </div>
    </main>
  );
}
