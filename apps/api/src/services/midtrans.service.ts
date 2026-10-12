import { AppError } from "../lib/errors.js";
import type { Config } from "../config.js";
import type { MidtransTransactionStatus } from "../lib/payment-outcome.js";
import { midtransBaseUrls } from "../lib/midtrans-urls.js";

export interface MidtransTransactionStatusResponse {
  order_id: string;
  transaction_id: string;
  transaction_status: MidtransTransactionStatus;
  fraud_status?: string;
  gross_amount: string;
}

export interface MidtransService {
  createSnapTransaction(params: {
    orderId: string;
    amount: number;
    customerName: string;
    customerEmail?: string;
  }): Promise<{ snapToken: string }>;

  /** Core API status check — the authoritative fallback when a webhook is lost. */
  checkTransactionStatus(
    orderId: string,
  ): Promise<MidtransTransactionStatusResponse>;
}

export function createMidtransService(deps: {
  config: Config;
}): MidtransService {
  // Sandbox or production based on env (lib/midtrans-urls.ts)
  const { snap: snapBaseUrl, core: coreBaseUrl } = midtransBaseUrls(
    deps.config.MIDTRANS_IS_PRODUCTION,
  );

  const authHeader = () =>
    `Basic ${Buffer.from(`${deps.config.MIDTRANS_SERVER_KEY}:`).toString("base64")}`;

  const requireServerKey = () => {
    if (!deps.config.MIDTRANS_SERVER_KEY) {
      throw new AppError(
        "MIDTRANS_CONFIG_MISSING",
        "Midtrans tidak dikonfigurasi",
        503,
      );
    }
  };

  return {
    async createSnapTransaction({
      orderId,
      amount,
      customerName,
      customerEmail,
    }) {
      requireServerKey();

      // Snap API request body (https://docs.midtrans.com/en/snap/overview)
      const snapParams = {
        transaction_details: {
          order_id: orderId,
          gross_amount: amount,
        },
        customer_details: {
          first_name: customerName,
          email: customerEmail || "customer@restaurant.local",
        },
      };

      try {
        const response = await fetch(`${snapBaseUrl}/transactions`, {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(snapParams),
          signal: AbortSignal.timeout(10_000),
        });

        const data = (await response.json()) as {
          token?: string;
          redirect_url?: string;
          status_code?: string;
          status_message?: string;
          error_id?: string;
        };

        // Check for API errors
        if (!response.ok || data.status_code !== "201") {
          throw new AppError(
            "MIDTRANS_API_ERROR",
            `Midtrans error: ${data.status_message || "Unknown error"}`,
            502,
          );
        }

        if (!data.token) {
          throw new AppError(
            "MIDTRANS_INVALID_RESPONSE",
            "Midtrans returned invalid response",
            502,
          );
        }

        return {
          snapToken: data.token,
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }

        // Network or parsing error
        throw new AppError(
          "MIDTRANS_REQUEST_FAILED",
          "Gagal terhubung ke Midtrans",
          502,
        );
      }
    },

    async checkTransactionStatus(orderId) {
      requireServerKey();

      try {
        const response = await fetch(
          `${coreBaseUrl}/${encodeURIComponent(orderId)}/status`,
          {
            headers: {
              Authorization: authHeader(),
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8_000),
          },
        );

        const data = (await response.json()) as {
          order_id?: string;
          transaction_id?: string;
          transaction_status?: MidtransTransactionStatus;
          fraud_status?: string;
          gross_amount?: string;
          status_message?: string;
        };

        if (
          !response.ok ||
          !data.transaction_status ||
          !data.order_id ||
          data.gross_amount === undefined
        ) {
          throw new AppError(
            "MIDTRANS_STATUS_FAILED",
            `Midtrans status check failed: ${data.status_message || response.status}`,
            502,
          );
        }

        return {
          order_id: data.order_id,
          transaction_id: data.transaction_id ?? "",
          transaction_status: data.transaction_status,
          fraud_status: data.fraud_status,
          gross_amount: data.gross_amount,
        };
      } catch (err: unknown) {
        if (err instanceof AppError) {
          throw err;
        }

        throw new AppError(
          "MIDTRANS_REQUEST_FAILED",
          "Gagal terhubung ke Midtrans",
          502,
        );
      }
    },
  };
}
