import type {
  BillResponse,
  CreateSessionResponse,
  MenuItemDetail,
  MenuResponse,
  CreateOrderResponse,
  CreateOrderItemRequest,
  OrderListResponse,
  PaymentInitiationRequest,
  PaymentInitiationResponse,
  PaymentMethod,
  PaymentStatusResponse,
} from "@malalabar/types";

export interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Carries the server's error `code` (API_Contract §1.2) so the UI can react to
 * a specific failure — QR_REGENERATED needs a different screen than a network
 * blip — instead of pattern-matching on message text.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Thrown when the request never reached the API at all. */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

export function createApiClient(baseUrl: string) {
  async function request<T>(
    path: string,
    options: RequestInit & { token?: string } = {},
  ): Promise<T> {
    const { token, headers, ...init } = options;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      });
    } catch {
      throw new ApiClientError(
        NETWORK_ERROR_CODE,
        "Tidak bisa terhubung ke server",
        0,
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiClientError(
        body?.error?.code ?? "UNKNOWN_ERROR",
        body?.error?.message ?? `Request failed (${res.status})`,
        res.status,
      );
    }

    return res.json() as Promise<T>;
  }

  return {
    health: (opts?: RequestInit) => request<HealthResponse>("/health", opts),

    /** QR scan entry point — exchanges the table token for a session. */
    createSession: (tableToken: string) =>
      request<CreateSessionResponse>("/sessions", {
        method: "POST",
        body: JSON.stringify({ tableToken }),
      }),

    getMenu: (token: string) => request<MenuResponse>("/menu", { token }),

    getMenuItem: (id: string, token: string) =>
      request<MenuItemDetail>(`/menu/items/${encodeURIComponent(id)}`, {
        token,
      }),

    submitOrder: (sessionId: string, body: { items: CreateOrderItemRequest[] }, token: string) =>
      request<CreateOrderResponse>(`/sessions/${encodeURIComponent(sessionId)}/orders`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      }),

    /** Tracking screen — still readable after payment until everything is served. */
    getOrders: (sessionId: string, token: string) =>
      request<OrderListResponse>(`/sessions/${encodeURIComponent(sessionId)}/orders`, {
        token,
      }),

    initiatePayment: (sessionId: string, method: PaymentMethod, token: string) =>
      request<PaymentInitiationResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/payment`,
        {
          method: "POST",
          body: JSON.stringify({ method }),
          token,
        },
      ),

    getBill: (sessionId: string, token: string) =>
      request<BillResponse>(`/sessions/${encodeURIComponent(sessionId)}/bill`, { token }),

    /** Polls the settled state when the webhook's realtime event is missed. */
    getPaymentStatus: (sessionId: string, token: string) =>
      request<PaymentStatusResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/payment-status`,
        { token },
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
