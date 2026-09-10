import QRCode from "qrcode";
import { config } from "../config.js";

/**
 * Kitchen device enrolment artefacts — Auth_RBAC_Spec §4.
 *
 * A device id is a cuid and the token is 32 random bytes; nobody should type
 * either into a tablet in a working kitchen. The superadmin screen shows a QR
 * of `<KDS_APP_URL>/?d=<deviceId>&t=<token>` instead: the tablet scans it once,
 * exchanges the pair for a device JWT, and drops the credentials from its URL.
 *
 * The QR is displayed on screen, never stored — the plaintext token exists in
 * exactly one API response (create / rotate).
 */

/** M keeps the code readable on a glare-heavy screen while staying compact. */
const ERROR_CORRECTION = "M" as const;

export function buildProvisioningUrl(input: {
  deviceId: string;
  token: string;
}): string {
  const url = new URL("/", config.KDS_APP_URL);
  url.searchParams.set("d", input.deviceId);
  url.searchParams.set("t", input.token);
  return url.toString();
}

/** `data:image/png;base64,…` — rendered inline by the admin app. */
export async function renderProvisioningQr(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: ERROR_CORRECTION,
    width: 320,
    margin: 2,
  });
}
