/**
 * Midtrans base URLs — the single place that decides sandbox vs production
 * (Midtrans_Integration_Spec §5). The payment service calls these URLs and the
 * Demo Mode startup check inspects the same values, so the check is about
 * where money would actually go, not about a flag.
 */
export interface MidtransBaseUrls {
  /** Snap API (create transaction). */
  snap: string;
  /** Core API (status check / reconciliation). */
  core: string;
}

export function midtransBaseUrls(isProduction: boolean): MidtransBaseUrls {
  return isProduction
    ? { snap: "https://app.midtrans.com/snap/v1", core: "https://api.midtrans.com/v2" }
    : {
        snap: "https://app.sandbox.midtrans.com/snap/v1",
        core: "https://api.sandbox.midtrans.com/v2",
      };
}

/** True only for an https URL on a `*.sandbox.midtrans.com` host. */
export function isSandboxMidtransUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(".sandbox.midtrans.com");
  } catch {
    return false;
  }
}
