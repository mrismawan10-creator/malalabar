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
    <main className="flex h-screen flex-col items-center justify-center bg-ink">
      <div className="border border-white/20 rounded-xl p-8 text-center">
        <h1 className="font-display text-display text-white mb-2">KDS</h1>
        <p className="font-ui text-lg text-white/70 mb-4">
          Kitchen Display System
        </p>
        <div
          className={`rounded-lg px-4 py-2 text-base font-ui ${
            health
              ? "bg-success/20 text-success"
              : "bg-danger/20 text-danger"
          }`}
        >
          API: {health ? `✓ ${health.status}` : "✗ unreachable"}
        </div>
      </div>
    </main>
  );
}
