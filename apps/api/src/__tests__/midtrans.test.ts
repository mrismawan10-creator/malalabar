import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMidtransService } from "../services/midtrans.service.js";
import type { Config } from "../config.js";

describe("MidtransService", () => {
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    // Mock config for sandbox
    mockConfig = {
      MIDTRANS_SERVER_KEY: "SB-Mid-server-key-test",
      MIDTRANS_IS_PRODUCTION: false,
    };

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe("createSnapTransaction", () => {
    it("creates Snap transaction and returns the snap token", async () => {
      const mockResponse = {
        token: "test-snap-token-abc123",
        redirect_url: "https://app.sandbox.midtrans.com/snap/v2/test-snap-token-abc123",
        status_code: "201",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const service = createMidtransService({ config: mockConfig as Config });
      const result = await service.createSnapTransaction({
        orderId: "session-1",
        amount: 150000,
        customerName: "Table 5",
      });

      expect(result).toEqual({
        snapToken: "test-snap-token-abc123",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://app.sandbox.midtrans.com/snap/v1/transactions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("throws error when Midtrans returns error status", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: async () => ({
          status_code: "400",
          status_message: "Invalid request",
        }),
      });

      const service = createMidtransService({ config: mockConfig as Config });

      expect(
        service.createSnapTransaction({
          orderId: "session-1",
          amount: 150000,
          customerName: "Table 5",
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "MIDTRANS_API_ERROR" }),
      );
    });

    it("throws error when server key is not configured", async () => {
      const noKeyConfig = { MIDTRANS_SERVER_KEY: "", MIDTRANS_IS_PRODUCTION: false };

      const service = createMidtransService({ config: noKeyConfig as Config });

      expect(
        service.createSnapTransaction({
          orderId: "session-1",
          amount: 150000,
          customerName: "Table 5",
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "MIDTRANS_CONFIG_MISSING" }),
      );
    });

    it("throws error on network failure", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const service = createMidtransService({ config: mockConfig as Config });

      expect(
        service.createSnapTransaction({
          orderId: "session-1",
          amount: 150000,
          customerName: "Table 5",
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "MIDTRANS_REQUEST_FAILED" }),
      );
    });
  });

  describe("checkTransactionStatus", () => {
    it("returns the mapped status fields from the Core API", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          order_id: "session-1",
          transaction_id: "txn-001",
          transaction_status: "settlement",
          fraud_status: "accept",
          gross_amount: "150000.00",
        }),
      });

      const service = createMidtransService({ config: mockConfig as Config });
      const result = await service.checkTransactionStatus("session-1");

      expect(result).toEqual({
        order_id: "session-1",
        transaction_id: "txn-001",
        transaction_status: "settlement",
        fraud_status: "accept",
        gross_amount: "150000.00",
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.sandbox.midtrans.com/v2/session-1/status",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/json",
          }),
        }),
      );
    });

    it("throws MIDTRANS_STATUS_FAILED on an error response", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          status_code: "404",
          status_message: "Transaction doesn't exist.",
        }),
      });

      const service = createMidtransService({ config: mockConfig as Config });

      expect(service.checkTransactionStatus("session-1")).rejects.toThrow(
        expect.objectContaining({ code: "MIDTRANS_STATUS_FAILED" }),
      );
    });

    it("throws MIDTRANS_CONFIG_MISSING without a server key", async () => {
      const service = createMidtransService({
        config: { MIDTRANS_SERVER_KEY: "", MIDTRANS_IS_PRODUCTION: false } as Config,
      });

      expect(service.checkTransactionStatus("session-1")).rejects.toThrow(
        expect.objectContaining({ code: "MIDTRANS_CONFIG_MISSING" }),
      );
    });
  });
});
