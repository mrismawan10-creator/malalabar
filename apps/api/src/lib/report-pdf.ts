import PDFDocument from "pdfkit";
import type { MenuPerformanceRow } from "@malalabar/types";
import type { PaymentBreakdownRow } from "../repositories/analytics.repository.js";

/**
 * PDF report rendering — PRD 4.6.3 ("dokumen terformat dengan header
 * restoran, logo, ringkasan eksekutif, dan grafik visualisasi").
 *
 * Built on the pdfkit already used for QR cards; built-in Helvetica only, no
 * font files, and charts are simple vector shapes so the PDF stays small.
 */

type PdfDoc = InstanceType<typeof PDFDocument>;

const ACCENT = "#4F7CAC";
const ACCENT_LIGHT = "#9DBBDA";
const MUTED = "#555555";
const INK = "#111111";
const GRID = "#DDDDDD";
const HEADER_BG = "#EEF2F7";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Tunai",
  CARD: "Kartu",
  ONLINE: "Online",
};

export interface PdfHeaderInfo {
  restaurantName: string;
  logo?: Buffer;
  periodLabel: string;
  generatedAt: string;
}

const rupiahFormatter = new Intl.NumberFormat("id-ID");

export function formatRupiah(amount: number): string {
  return `Rp ${rupiahFormatter.format(amount)}`;
}

function renderDoc(build: (doc: PdfDoc) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  build(doc);
  doc.end();
  return finished;
}

const pageWidth = (doc: PdfDoc) =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

/** Jump to a fresh page when `height` no longer fits. */
function ensureSpace(doc: PdfDoc, height: number): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawHeader(doc: PdfDoc, info: PdfHeaderInfo): void {
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const width = pageWidth(doc);

  if (info.logo) {
    doc.image(info.logo, left + width - 60, top, {
      width: 60,
      height: 60,
      fit: [60, 60],
    });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(INK)
    .text(info.restaurantName, left, top, {
      width: info.logo ? width - 76 : width,
    });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(info.periodLabel, left, doc.y + 4, {
      width: info.logo ? width - 76 : width,
    });
  doc
    .fontSize(8.5)
    .text(`Dibuat ${info.generatedAt} WIB`, left, doc.y + 2);

  doc
    .moveTo(left, doc.y + 10)
    .lineTo(left + width, doc.y + 10)
    .lineWidth(0.7)
    .strokeColor(GRID)
    .stroke();
  doc.y += 18;
}

function sectionTitle(doc: PdfDoc, title: string): void {
  ensureSpace(doc, 34);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(title);
  doc.moveDown(0.7);
}

function drawMetrics(
  doc: PdfDoc,
  metrics: Array<{ label: string; value: string }>,
): void {
  const count = metrics.length;
  const gap = 12;
  const boxWidth = (pageWidth(doc) - gap * (count - 1)) / count;
  const boxHeight = 50;
  const left = doc.page.margins.left;
  const y = doc.y;

  metrics.forEach((metric, index) => {
    const x = left + index * (boxWidth + gap);
    doc.rect(x, y, boxWidth, boxHeight).fillAndStroke("#FAFAFA", GRID);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(metric.label, x + 10, y + 8, { width: boxWidth - 20 });
    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor(INK)
      .text(metric.value, x + 10, y + 24, { width: boxWidth - 20 });
  });

  doc.y = y + boxHeight + 16;
}

function drawHorizontalBars(
  doc: PdfDoc,
  data: Array<{ label: string; value: number }>,
): void {
  const left = doc.page.margins.left;
  const labelWidth = 150;
  const valueWidth = 62;
  const barMaxWidth = pageWidth(doc) - labelWidth - valueWidth - 18;
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowHeight = 19;

  for (const datum of data) {
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(INK)
      .text(datum.label, left, y + 1, { width: labelWidth, ellipsis: true });
    doc
      .rect(
        left + labelWidth + 8,
        y + 3,
        Math.max(2, (datum.value / max) * barMaxWidth),
        11,
      )
      .fill(ACCENT);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .text(String(datum.value), left + labelWidth + 8 + barMaxWidth + 6, y + 1, {
        width: valueWidth - 6,
        align: "right",
      });
    doc.y = y + rowHeight;
  }
}

/** 24 vertical bars, one per WIB hour. */
function drawHourBars(
  doc: PdfDoc,
  data: Array<{ hour: number; revenue: number }>,
): void {
  const left = doc.page.margins.left;
  const axisWidth = 52;
  const chartHeight = 128;
  const chartWidth = pageWidth(doc) - axisWidth;
  const slotWidth = chartWidth / 24;
  const barWidth = Math.max(1, slotWidth * 0.6);
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const x0 = left + axisWidth;
  const top = doc.y;
  const bottom = top + chartHeight;

  ensureSpace(doc, chartHeight + 26);

  doc
    .moveTo(x0, top)
    .lineTo(x0 + chartWidth, top)
    .lineWidth(0.5)
    .strokeColor(GRID)
    .stroke();
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(formatRupiah(max), left, top - 2, { width: axisWidth - 6, align: "right" });

  data.forEach((datum) => {
    const height = (datum.revenue / max) * (chartHeight - 12);
    const x = x0 + datum.hour * slotWidth + (slotWidth - barWidth) / 2;
    doc
      .rect(x, bottom - height, barWidth, Math.max(0.5, height))
      .fill(datum.hour >= 12 ? ACCENT : ACCENT_LIGHT);
  });

  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) {
    doc.text(String(hour).padStart(2, "0"), x0 + hour * slotWidth, bottom + 4, {
      width: slotWidth * 2.4,
    });
  }

  doc.y = bottom + 16;
}

function drawTable(
  doc: PdfDoc,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): void {
  const left = doc.page.margins.left;
  const topMargin = doc.page.margins.top;
  const headerHeight = 19;
  const rowHeight = 17;

  const drawRow = (cells: string[], isHeader: boolean): void => {
    const height = isHeader ? headerHeight : rowHeight;
    const y = doc.y;
    let x = left;
    if (isHeader) {
      doc.rect(left, y, colWidths.reduce((sum, w) => sum + w, 0), height).fill(HEADER_BG);
    }
    cells.forEach((cell, index) => {
      doc
        .font(isHeader ? "Helvetica-Bold" : "Helvetica")
        .fontSize(isHeader ? 9 : 9.5)
        .fillColor(INK)
        .text(cell, x + 5, y + 4, {
          width: colWidths[index]! - 10,
          height: height - 6,
          ellipsis: true,
        });
      x += colWidths[index]!;
    });
    doc.y = y + height;
  };

  ensureSpace(doc, headerHeight + rowHeight + 4);
  drawRow(headers, true);
  for (const row of rows) {
    ensureSpace(doc, rowHeight);
    if (doc.y <= topMargin + 2) {
      // A page break just happened — repeat the header row.
      drawRow(headers, true);
    }
    drawRow(row, false);
  }
}

function tableWidths(doc: PdfDoc, ratios: number[]): number[] {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  return ratios.map((ratio) => (pageWidth(doc) * ratio) / total);
}

// ── Per-type documents ────────────────────────────────────────────────────────

export function renderSalesSummaryPdf(input: {
  info: PdfHeaderInfo;
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  topItems: Array<{ name: string; quantitySold: number }>;
  revenueByCategory: Array<{ category: string; revenue: number }>;
  revenueByHour: Array<{ hour: number; revenue: number }>;
  paymentBreakdown: PaymentBreakdownRow[];
}): Promise<Buffer> {
  return renderDoc((doc) => {
    drawHeader(doc, input.info);
    drawMetrics(doc, [
      { label: "TOTAL REVENUE", value: formatRupiah(input.totalRevenue) },
      { label: "TOTAL ORDERS", value: String(input.totalOrders) },
      { label: "AVERAGE ORDER VALUE", value: formatRupiah(input.averageOrderValue) },
    ]);

    sectionTitle(doc, "Pendapatan per Jam (WIB)");
    drawHourBars(doc, input.revenueByHour);

    sectionTitle(doc, "Top 10 Item Terlaris");
    drawHorizontalBars(
      doc,
      input.topItems.map((item) => ({ label: item.name, value: item.quantitySold })),
    );

    sectionTitle(doc, "Pendapatan per Kategori");
    drawTable(
      doc,
      ["Kategori", "Pendapatan"],
      input.revenueByCategory.map((row) => [row.category, formatRupiah(row.revenue)]),
      tableWidths(doc, [3, 1]),
    );

    sectionTitle(doc, "Metode Pembayaran");
    const totalCount = input.paymentBreakdown.reduce((sum, row) => sum + row.count, 0);
    const totalAmount = input.paymentBreakdown.reduce((sum, row) => sum + row.amount, 0);
    drawTable(
      doc,
      ["Metode", "Transaksi", "Nominal"],
      [
        ...input.paymentBreakdown.map((row) => [
          METHOD_LABEL[row.method] ?? row.method,
          String(row.count),
          formatRupiah(row.amount),
        ]),
        ["TOTAL", String(totalCount), formatRupiah(totalAmount)],
      ],
      tableWidths(doc, [2, 1, 1]),
    );
  });
}

export function renderMenuPerformancePdf(input: {
  info: PdfHeaderInfo;
  rows: MenuPerformanceRow[];
}): Promise<Buffer> {
  return renderDoc((doc) => {
    drawHeader(doc, input.info);
    const totalSold = input.rows.reduce((sum, row) => sum + row.quantitySold, 0);
    const totalRevenue = input.rows.reduce((sum, row) => sum + row.revenue, 0);
    const available = input.rows.filter((row) => row.isAvailable).length;

    drawMetrics(doc, [
      { label: "TOTAL ITEM TERJUAL", value: String(totalSold) },
      { label: "TOTAL PENDAPATAN ITEM", value: formatRupiah(totalRevenue) },
      { label: "ITEM TERSEDIA", value: String(available) },
    ]);

    sectionTitle(doc, "Top 10 Berdasarkan Quantity");
    drawHorizontalBars(
      doc,
      input.rows
        .slice(0, 10)
        .map((row) => ({ label: row.name, value: row.quantitySold })),
    );

    sectionTitle(doc, "Ranking Semua Menu");
    drawTable(
      doc,
      ["Item", "Terjual", "Pendapatan", "Tersedia", "Hari Habis"],
      input.rows.map((row) => [
        row.name,
        String(row.quantitySold),
        formatRupiah(row.revenue),
        row.isAvailable ? "Ya" : "Tidak",
        String(row.daysOutOfStock),
      ]),
      tableWidths(doc, [3, 1, 1.4, 1, 1]),
    );
  });
}

export function renderPaymentReportPdf(input: {
  info: PdfHeaderInfo;
  breakdown: PaymentBreakdownRow[];
}): Promise<Buffer> {
  return renderDoc((doc) => {
    drawHeader(doc, input.info);
    const totalCount = input.breakdown.reduce((sum, row) => sum + row.count, 0);
    const totalAmount = input.breakdown.reduce((sum, row) => sum + row.amount, 0);

    drawMetrics(doc, [
      { label: "TOTAL TRANSAKSI", value: String(totalCount) },
      { label: "TOTAL NOMINAL", value: formatRupiah(totalAmount) },
    ]);

    sectionTitle(doc, "Nominal per Metode");
    drawHorizontalBars(
      doc,
      input.breakdown.map((row) => ({
        label: METHOD_LABEL[row.method] ?? row.method,
        value: row.amount,
      })),
    );

    sectionTitle(doc, "Rincian per Metode Pembayaran");
    drawTable(
      doc,
      ["Metode", "Transaksi", "Nominal"],
      [
        ...input.breakdown.map((row) => [
          METHOD_LABEL[row.method] ?? row.method,
          String(row.count),
          formatRupiah(row.amount),
        ]),
        ["TOTAL", String(totalCount), formatRupiah(totalAmount)],
      ],
      tableWidths(doc, [2, 1, 1]),
    );
  });
}
