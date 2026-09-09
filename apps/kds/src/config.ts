export const config = {
  apiBaseUrl:
    process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:4000",
  wsUrl:
    process.env["NEXT_PUBLIC_WS_URL"] ?? "http://localhost:4000",
} as const;
