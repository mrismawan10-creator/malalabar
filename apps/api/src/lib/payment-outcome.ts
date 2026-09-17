export type MidtransTransactionStatus =
  | "capture"
  | "settlement"
  | "pending"
  | "deny"
  | "expire"
  | "cancel";

export type PaymentOutcome = "PAID" | "PENDING" | "FAILED" | "EXPIRED";

export function mapMidtransStatus(
  status: MidtransTransactionStatus,
  fraudStatus?: string | null,
): PaymentOutcome {
  if (status === "settlement") return "PAID";
  if (status === "capture") return fraudStatus === "accept" ? "PAID" : "PENDING";
  if (status === "deny" || status === "cancel") return "FAILED";
  if (status === "expire") return "EXPIRED";
  return "PENDING";
}
