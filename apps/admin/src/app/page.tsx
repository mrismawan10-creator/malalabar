import { createApiClient } from "@malalabar/ui";
import { config } from "@/config";

async function getHealth() {
  try {
    const api = createApiClient(`${config.apiBaseUrl}/api/v1`);
    return await api.health({ cache: "no-store" });
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-surface-page">
      <div className="bg-surface-raised border border-surface-line rounded-md p-6 text-center max-w-sm w-full">
        <h1 className="font-ui text-xl font-semibold text-ink mb-4">
          Malalabar Admin
        </h1>
        <div
          className={`rounded px-3 py-2 text-sm font-ui ${
            health
              ? "bg-success/10 text-success-ink"
              : "bg-danger/10 text-danger-ink"
          }`}
        >
          API: {health ? `✓ ${health.status}` : "✗ unreachable"}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <a
            href="/cashier"
            className="rounded-lg bg-primary px-4 py-3 text-center font-ui font-semibold text-white hover:bg-primary-hover"
          >
            Kasir
          </a>
          <a
            href="/menu"
            className="rounded-lg bg-primary px-4 py-3 text-center font-ui font-semibold text-white hover:bg-primary-hover"
          >
            Menu
          </a>
          <a
            href="/tables"
            className="rounded-lg bg-primary px-4 py-3 text-center font-ui font-semibold text-white hover:bg-primary-hover"
          >
            Meja & QR
          </a>
        </div>
      </div>
    </main>
  );
}
