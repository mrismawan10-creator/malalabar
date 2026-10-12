import { envFlag, envText, envUrl } from "@malalabar/ui";

// NEXT_PUBLIC_* values are inlined at build time; envUrl/envText/envFlag strip
// whitespace pasted into the hosting dashboard (a leading tab broke Socket.io).
export const config = {
  apiBaseUrl: envUrl(process.env["NEXT_PUBLIC_API_BASE_URL"], "http://localhost:4000/api/v1"),
  wsUrl: envUrl(process.env["NEXT_PUBLIC_WS_URL"], "http://localhost:4000"),
  midtransClientKey: envText(process.env["NEXT_PUBLIC_MIDTRANS_CLIENT_KEY"]),
  midtransSnapUrl: envUrl(
    process.env["NEXT_PUBLIC_MIDTRANS_SNAP_URL"],
    "https://app.sandbox.midtrans.com/snap/snap.js",
  ),
  /** Shows the Demo Mode banner (docs/Demo_Mode.md). Off unless "true". */
  demoMode: envFlag(process.env["NEXT_PUBLIC_DEMO_MODE"]),
} as const;
