export const config = {
  apiBaseUrl:
    process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:4000",
  wsUrl:
    process.env["NEXT_PUBLIC_WS_URL"] ?? "http://localhost:4000",
  /** Shows the Demo Mode banner (docs/Demo_Mode.md). Off unless exactly "true". */
  demoMode: process.env["NEXT_PUBLIC_DEMO_MODE"] === "true",
} as const;
