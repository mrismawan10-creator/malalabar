import { config } from "@/config";

export class AdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** Thin fetch wrapper for staff-authenticated calls; surfaces the API's error code. */
export async function adminFetch<T>(
  path: string,
  token: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/api/v1${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new AdminApiError("NETWORK_ERROR", "Tidak bisa terhubung ke server", 0);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new AdminApiError(
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

export const rupiah = (n: number) =>
  n.toLocaleString("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 });
