export const config = {
  apiBaseUrl:
    process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:4000/api/v1",
  wsUrl:
    process.env["NEXT_PUBLIC_WS_URL"] ?? "http://localhost:4000",
  midtransClientKey:
    process.env["NEXT_PUBLIC_MIDTRANS_CLIENT_KEY"] ?? "",
  midtransSnapUrl:
    process.env["NEXT_PUBLIC_MIDTRANS_SNAP_URL"] ??
    "https://app.sandbox.midtrans.com/snap/snap.js",
} as const;
