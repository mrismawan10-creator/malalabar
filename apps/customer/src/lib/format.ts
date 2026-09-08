/** Money is integer Rupiah minor units (CLAUDE.md hard rule 7): 15000 → "Rp 15.000". */
export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
