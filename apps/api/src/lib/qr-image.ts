import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { config } from "../config.js";

/**
 * QR artefact rendering — PRD 4.1.2, API_Contract §6 (Tables & QR).
 *
 * The QR encodes `<CUSTOMER_APP_URL>/order?t=<qrToken>`. The token is the
 * opaque signed value from qr-token.ts; the table number never appears in the
 * URL (CLAUDE.md hard rule 6).
 */

/** Error correction M keeps the code readable through print smudging and
 *  partial glare while staying compact enough to print small. */
const ERROR_CORRECTION = "M" as const;

export function buildTableOrderUrl(qrToken: string): string {
  const url = new URL("/order", config.CUSTOMER_APP_URL);
  url.searchParams.set("t", qrToken);
  return url.toString();
}

export async function renderQrPng(qrToken: string): Promise<Buffer> {
  return QRCode.toBuffer(buildTableOrderUrl(qrToken), {
    type: "png",
    errorCorrectionLevel: ERROR_CORRECTION,
    width: 800, // generous for print; scales down cleanly on screen
    margin: 2,
  });
}

export interface QrPdfInput {
  qrToken: string;
  number: string;
  area: string | null;
}

/**
 * A5 portrait table card, ready to print and stand on a table (PRD 4.1.2).
 * Built-in Helvetica only — no font files to ship.
 */
export async function renderQrPdf(input: QrPdfInput): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(buildTableOrderUrl(input.qrToken), {
    type: "png",
    errorCorrectionLevel: ERROR_CORRECTION,
    width: 1000,
    margin: 1,
  });

  const doc = new PDFDocument({ size: "A5", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .font("Helvetica-Bold")
    .fontSize(30)
    .text(`Meja ${input.number}`, { align: "center" });

  if (input.area) {
    doc
      .moveDown(0.2)
      .font("Helvetica")
      .fontSize(15)
      .fillColor("#555555")
      .text(input.area, { align: "center" })
      .fillColor("#000000");
  }

  const qrSize = Math.min(pageWidth, 260);
  doc.moveDown(1);
  doc.image(qrPng, doc.page.margins.left + (pageWidth - qrSize) / 2, doc.y, {
    width: qrSize,
    height: qrSize,
  });

  doc.y += qrSize;
  doc
    .moveDown(1.2)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("Scan untuk memesan", { align: "center" })
    .moveDown(0.3)
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#555555")
    .text("Arahkan kamera ponsel ke kode di atas", { align: "center" });

  doc.end();
  return finished;
}

/** `Meja 05` + `Outdoor` → `meja-05-outdoor`. Safe for Content-Disposition. */
export function qrFileBaseName(number: string, area: string | null): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const parts = ["meja", slug(number)];
  if (area) {
    const areaSlug = slug(area);
    if (areaSlug) parts.push(areaSlug);
  }
  return parts.filter(Boolean).join("-");
}
