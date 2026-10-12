import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z4 from "zod/v4";
import { z } from "zod";
import type { Prisma } from "@malalabar/db";
import type {
  AnalyticsInsightResponse,
  AnalyticsSummaryResponse,
} from "@malalabar/types";
import { consumeDailyQuota, DEMO_AI_LIMIT_MESSAGE } from "../lib/daily-quota.js";
import type { QuotaStore } from "../lib/daily-quota.js";
import { resolveAnalyticsRange, wibDateLabel } from "../lib/date-range.js";
import type { PeriodInput } from "../lib/date-range.js";
import { AppError } from "../lib/errors.js";
import { percentDelta } from "./analytics.service.js";
import type { AnalyticsService } from "./analytics.service.js";

/**
 * AI Insight — POST /admin/analytics/insight (API_Contract §7).
 *
 * The model only narrates numbers the server already computed: both periods
 * come from AnalyticsService.getSummary() (no new numeric queries), every
 * comparison and share is calculated here, and the payload is an explicit
 * whitelist of aggregates — no IDs, names of people, emails, tokens or
 * payment-gateway references ever leave the server.
 */

/** What the model must return (structured outputs, validated by the SDK). */
const InsightOutputSchema = z4.object({
  headline: z4.string(),
  highlights: z4.array(z4.string()),
  concerns: z4.array(z4.string()),
  actions: z4.array(z4.string()),
});

/** Our own bounds, checked after the SDK parse — the API strips length and
 *  count constraints from structured-output schemas, so they live here. */
const InsightResultSchema = z.object({
  headline: z.string().trim().min(1).max(400),
  highlights: z.array(z.string().trim().min(1).max(400)).max(8),
  concerns: z.array(z.string().trim().min(1).max(400)).max(8),
  actions: z.array(z.string().trim().min(1).max(400)).min(1).max(5),
});
type InsightResult = z.infer<typeof InsightResultSchema>;

export const INSIGHT_MAX_TOKENS = 4000;
export const INSIGHT_CACHE_TTL_SECONDS = 3600;
const CACHE_PREFIX = "malalabar:ai-insight:v1";

export const INSIGHT_SYSTEM_PROMPT = `Anda adalah analis penjualan untuk sebuah restoran di Indonesia. Anda menerima ringkasan penjualan dalam bentuk JSON untuk satu periode dan periode sebelumnya yang sama panjangnya.

Tulis ringkasan singkat dalam Bahasa Indonesia untuk pemilik restoran:
- headline: satu kalimat tentang kondisi periode ini.
- highlights: hal yang naik atau berjalan baik — termasuk menu terlaris, jam ramai, dan metode pembayaran yang menonjol.
- concerns: hal yang turun atau melemah, termasuk menu yang penjualannya turun atau keluar dari 10 besar. Kosongkan jika tidak ada.
- actions: 2 sampai 3 saran tindakan yang konkret dan bisa langsung dilakukan.

Aturan:
- Gunakan hanya angka yang ada di data; jangan mengarang atau menghitung ulang. Semua perbandingan dan persentase sudah dihitung di field yang tersedia.
- Semua jam dalam zona waktu WIB (Asia/Jakarta, UTC+7); selalu tulis "WIB" saat menyebut jam.
- Mata uang Rupiah; tulis seperti "Rp 1.250.000".
- Nilai null berarti datanya tidak tersedia (misalnya menu di luar 10 besar periode sebelumnya); jangan menebaknya.
- Jangan menyebut data yang tidak ada di JSON.`;

const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const METHOD_LABEL_ID: Record<string, string> = { CASH: "Tunai", CARD: "Kartu", ONLINE: "Online" };

/** Share of `part` in `total` as a percentage with 1 decimal; 0 when total is 0. */
function share(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

const hourLabel = (hour: number) => {
  const hh = String(hour).padStart(2, "0");
  return `${hh}:00–${hh}:59 WIB`;
};

/**
 * The exact JSON the model sees. Built field by field from the summary — a
 * whitelist, so anything added to AnalyticsSummaryResponse later does not
 * leak into the prompt by accident.
 */
export function buildInsightInput(
  current: AnalyticsSummaryResponse,
  previous: AnalyticsSummaryResponse,
  period: { from: string; to: string },
  previousPeriod: { from: string; to: string },
) {
  const prevQty = new Map(previous.topItems.map((i) => [i.name, i.quantitySold]));
  const currentNames = new Set(current.topItems.map((i) => i.name));
  const paidTotal = current.paymentBreakdown.reduce((s, p) => s + p.amount, 0);
  const activeHours = current.revenueByHour.filter((h) => h.revenue > 0);
  const peakHours = [...activeHours].sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  return {
    timezone: "Asia/Jakarta (WIB, UTC+7)",
    currency: "IDR (Rupiah, bilangan bulat)",
    period: { from: period.from, to: period.to },
    previousPeriod: { from: previousPeriod.from, to: previousPeriod.to },
    totals: {
      revenue: current.totalRevenue,
      orders: current.totalOrders,
      averageOrderValue: current.averageOrderValue,
      previousRevenue: previous.totalRevenue,
      previousOrders: previous.totalOrders,
      previousAverageOrderValue: previous.averageOrderValue,
      revenueChangePercent: current.comparison.revenueDelta,
      ordersChangePercent: current.comparison.ordersDelta,
      averageOrderValueChangePercent: current.comparison.aovDelta,
    },
    topItems: current.topItems.map((item, index) => {
      const before = prevQty.get(item.name) ?? null;
      return {
        rank: index + 1,
        name: item.name,
        quantitySold: item.quantitySold,
        previousQuantitySold: before,
        changePercent: before === null ? null : percentDelta(item.quantitySold, before),
      };
    }),
    droppedFromTopItems: previous.topItems
      .filter((item) => !currentNames.has(item.name))
      .map((item) => ({ name: item.name, previousQuantitySold: item.quantitySold })),
    revenueByCategory: current.revenueByCategory.map((c) => ({
      category: c.category,
      revenue: c.revenue,
      sharePercent: share(c.revenue, current.totalRevenue),
    })),
    revenueByHourWib: activeHours.map((h) => ({ hour: hourLabel(h.hour), revenue: h.revenue })),
    peakHoursWib: peakHours.map((h) => ({
      hour: hourLabel(h.hour),
      revenue: h.revenue,
      sharePercent: share(h.revenue, current.totalRevenue),
    })),
    ordersByDayWib: current.orderVolumeByDay.map((d) => ({
      date: d.date,
      weekday: WEEKDAYS_ID[new Date(`${d.date}T00:00:00Z`).getUTCDay()],
      orders: d.count,
    })),
    paymentMethods: current.paymentBreakdown.map((p) => ({
      method: METHOD_LABEL_ID[p.method] ?? p.method,
      transactions: p.count,
      amount: p.amount,
      amountSharePercent: share(p.amount, paidTotal),
    })),
  };
}

export type InsightInput = ReturnType<typeof buildInsightInput>;

/** The SDK surface this service uses; tests pass a fake. */
export type InsightModelClient = Pick<Anthropic, "messages">;

/** Best-effort cache (Redis in production). Failures are swallowed. */
export interface InsightCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface InsightActor {
  staffId: string;
  isDemoAccount: boolean;
  ipAddress?: string;
}

export interface AnalyticsInsightService {
  /** True when an API key is configured (GET /analytics/insight/status). */
  isConfigured(): boolean;
  generate(input: PeriodInput, actor: InsightActor): Promise<AnalyticsInsightResponse>;
}

export function createAnalyticsInsightService(deps: {
  analytics: AnalyticsService;
  client: InsightModelClient | null;
  model: string;
  cache: InsightCache;
  quota: { store: QuotaStore; demoDailyLimit: number };
  writeAudit: (input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonObject;
    ipAddress?: string;
  }) => Promise<void>;
  /** Server-side diagnostics; never receives prompt text or keys. */
  log?: (message: string, err?: unknown) => void;
  now?: () => Date;
}): AnalyticsInsightService {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  async function audit(
    actor: InsightActor,
    input: PeriodInput,
    period: { from: string; to: string },
    cache: "hit" | "miss" | "empty",
  ) {
    await deps.writeAudit({
      actorId: actor.staffId,
      action: "AI_INSIGHT",
      entityType: "ANALYTICS",
      entityId: "insight",
      metadata: {
        period: input.period,
        from: period.from,
        to: period.to,
        cache,
        model: cache === "empty" ? null : deps.model,
      },
      ipAddress: actor.ipAddress,
    });
  }

  async function callModel(payload: InsightInput): Promise<InsightResult> {
    const client = deps.client!;
    let response;
    try {
      response = await client.messages.parse({
        model: deps.model,
        max_tokens: INSIGHT_MAX_TOKENS,
        // Haiku 5.5 thinks adaptively by default; low effort keeps it brief.
        // No temperature/top_p: non-default sampling parameters return a 400.
        output_config: { effort: "low", format: zodOutputFormat(InsightOutputSchema) },
        system: INSIGHT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Data penjualan (JSON):\n${JSON.stringify(payload)}`,
          },
        ],
      });
    } catch (err) {
      // Most specific first (shared/error-codes): timeout ⊂ connection error.
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AppError("AI_TIMEOUT", "Layanan AI terlalu lama merespons. Coba lagi sebentar.", 504);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new AppError("AI_UNAVAILABLE", "Layanan AI sedang sibuk. Coba lagi beberapa saat lagi.", 503);
      }
      if (err instanceof Anthropic.APIError) {
        // Auth, bad request (e.g. a wrong model ID), 5xx, connection errors.
        log(`AI Insight request failed (status ${String(err.status ?? "n/a")})`, err);
        throw new AppError("AI_UNAVAILABLE", "Layanan AI sedang tidak tersedia. Coba lagi nanti.", 503);
      }
      // Anything else is the SDK failing to parse the structured output.
      log("AI Insight output could not be parsed", err);
      throw new AppError("AI_INVALID_OUTPUT", "Hasil AI tidak dapat dibaca. Coba buat ulang.", 502);
    }

    if (response.stop_reason === "refusal") {
      throw new AppError("AI_DECLINED", "AI tidak dapat membuat ringkasan untuk data ini.", 422);
    }
    if (response.stop_reason === "max_tokens") {
      log("AI Insight hit max_tokens");
      throw new AppError("AI_INVALID_OUTPUT", "Hasil AI tidak lengkap. Coba buat ulang.", 502);
    }
    const checked = InsightResultSchema.safeParse(response.parsed_output);
    if (!checked.success) {
      log("AI Insight output failed validation");
      throw new AppError("AI_INVALID_OUTPUT", "Hasil AI tidak dapat dibaca. Coba buat ulang.", 502);
    }
    return checked.data;
  }

  return {
    isConfigured() {
      return deps.client !== null;
    },

    async generate(input, actor) {
      if (!deps.client) {
        throw new AppError("AI_NOT_CONFIGURED", "Fitur AI belum dikonfigurasi.", 503);
      }

      const at = now();
      const range = resolveAnalyticsRange(input, at);
      const lastDay = (end: Date) => wibDateLabel(new Date(end.getTime() - 1));
      const period = { from: wibDateLabel(range.from), to: lastDay(range.to) };
      const previousPeriod = { from: wibDateLabel(range.prevFrom), to: lastDay(range.prevTo) };

      const [current, previous] = await Promise.all([
        deps.analytics.getSummary(input),
        deps.analytics.getSummary({ period: "custom", ...previousPeriod }),
      ]);

      // Nothing sold: no model call, no quota, a fixed message.
      if (current.totalOrders === 0 && current.totalRevenue === 0) {
        await audit(actor, input, period, "empty");
        return {
          headline: "Belum ada penjualan pada periode ini.",
          highlights: [],
          concerns:
            previous.totalOrders > 0
              ? [`Periode sebelumnya tercatat ${previous.totalOrders} pesanan.`]
              : [],
          actions: [
            "Pastikan pemesanan sedang dibuka dan menu tersedia.",
            "Pilih periode lain untuk melihat insight.",
          ],
          generatedAt: at.toISOString(),
          cached: false,
          model: null,
          period,
        };
      }

      const payload = buildInsightInput(current, previous, period, previousPeriod);
      const key = `${CACHE_PREFIX}:${deps.model}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;

      const cachedRaw = await deps.cache.get(key).catch(() => null);
      if (cachedRaw) {
        try {
          const hit = JSON.parse(cachedRaw) as AnalyticsInsightResponse;
          await audit(actor, input, period, "hit");
          return { ...hit, cached: true };
        } catch {
          // Corrupt entry: fall through and regenerate.
        }
      }

      // Demo accounts pay with their daily quota — only for real model calls.
      if (actor.isDemoAccount) {
        const quota = await consumeDailyQuota(
          deps.quota.store,
          `ai-insight:${actor.staffId}`,
          deps.quota.demoDailyLimit,
          at,
        );
        if (!quota.allowed) {
          throw new AppError("AI_QUOTA_EXCEEDED", DEMO_AI_LIMIT_MESSAGE, 429);
        }
      }

      const result = await callModel(payload);
      const response: AnalyticsInsightResponse = {
        ...result,
        generatedAt: at.toISOString(),
        cached: false,
        model: deps.model,
        period,
      };
      await deps.cache
        .set(key, JSON.stringify(response), INSIGHT_CACHE_TTL_SECONDS)
        .catch(() => undefined);
      await audit(actor, input, period, "miss");
      return response;
    },
  };
}
