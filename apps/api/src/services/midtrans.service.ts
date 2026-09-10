import { AppError } from "../lib/errors.js";
import type { Config } from "../config.js";

export interface MidtransService {
  createSnapTransaction(params: {
    orderId: string;
    amount: number;
    customerName: string;
    customerEmail?: string;
  }): Promise<{ snapToken: string; transactionId: string }>;
}

export function createMidtransService(deps: {
  config: Config;
}): MidtransService {
  // Snap API endpoint — sandbox or production based on env
  const baseUrl = deps.config.MIDTRANS_IS_PRODUCTION
    ? "https://app.midtrans.com/snap/v1"
    : "https://app.sandbox.midtrans.com/snap/v1";

  return {
    async createSnapTransaction({
      orderId,
      amount,
      customerName,
      customerEmail,
    }) {
      if (!deps.config.MIDTRANS_SERVER_KEY) {
        throw new AppError(
          "MIDTRANS_CONFIG_MISSING",
          "Midtrans tidak dikonfigurasi",
          503,
        );
      }

      // Base64 encode server key for Basic Auth
      const auth = Buffer.from(`${deps.config.MIDTRANS_SERVER_KEY}:`).toString(
        "base64",
      );

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
        const response = await fetch(`${baseUrl}/transactions`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(snapParams),
        });

        const data = (await response.json()) as {
          token?: string;
          redirect_url?: string;
          transaction_id?: string;
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

        if (!data.token || !data.transaction_id) {
          throw new AppError(
            "MIDTRANS_INVALID_RESPONSE",
            "Midtrans returned invalid response",
            502,
          );
        }

        return {
          snapToken: data.token,
          transactionId: data.transaction_id,
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
  };
}
