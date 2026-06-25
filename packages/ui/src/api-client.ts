export interface HealthResponse {
  status: string;
  timestamp: string;
}

export function createApiClient(baseUrl: string) {
  const get = async <T>(path: string, options?: RequestInit): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, options);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  };

  return {
    health: (opts?: RequestInit) => get<HealthResponse>("/health", opts),
  };
}
