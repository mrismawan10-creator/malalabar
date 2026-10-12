"use client";

import { useEffect, useState } from "react";
import type {
  AnalyticsInsightRequest,
  AnalyticsInsightResponse,
  AnalyticsInsightStatusResponse,
} from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";

/**
 * AI Insight card (API_Contract §7): a written summary of the selected period,
 * generated on demand from the same aggregates as the charts above.
 */

const AI_DISCLAIMER =
  "Dibuat oleh AI dari data penjualan Anda — periksa kembali sebelum mengambil keputusan.";

function InsightList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
      <ul className="mt-1 space-y-1 list-disc pl-5 text-sm text-ink">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyticsInsight({
  token,
  request,
  ready,
  onUnauthorized,
}: {
  token: string;
  request: AnalyticsInsightRequest;
  /** False while a custom period is incomplete. */
  ready: boolean;
  onUnauthorized: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [insight, setInsight] = useState<AnalyticsInsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    adminFetch<AnalyticsInsightStatusResponse>("/admin/analytics/insight/status", token)
      .then((res) => setConfigured(res.configured))
      .catch(() => setConfigured(null));
  }, [token]);

  // A result belongs to one period: clear it when the period changes.
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    setInsight(null);
    setError(null);
  }, [requestKey]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<AnalyticsInsightResponse>("/admin/analytics/insight", token, {
        method: "POST",
        json: request,
      });
      setInsight(res);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        onUnauthorized();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal membuat insight. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || !ready || configured === false;

  return (
    <div className="bg-surface-raised border border-surface-line rounded-lg p-4 shadow-hard-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">AI Insight</h2>
          <p className="text-xs text-ink-secondary">
            Ringkasan otomatis untuk periode yang dipilih.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={disabled}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
        >
          {loading ? "Menyusun insight…" : insight ? "Buat Ulang" : "Buat Insight"}
        </button>
      </div>

      {configured === false && (
        <p className="mt-3 text-sm text-ink-secondary">Fitur AI belum dikonfigurasi.</p>
      )}

      {error && (
        <div className="mt-3 bg-danger/10 text-danger-ink rounded-lg px-3 py-2 text-sm">{error}</div>
      )}

      {insight && (
        <div className="mt-4 space-y-3">
          <p className="text-base font-semibold text-ink">{insight.headline}</p>
          <InsightList title="Sorotan" items={insight.highlights} tone="text-success-ink" />
          <InsightList title="Perlu Perhatian" items={insight.concerns} tone="text-danger-ink" />
          <InsightList title="Saran Tindakan" items={insight.actions} tone="text-ink-secondary" />
          <p className="text-xs text-ink-secondary">
            {insight.period.from} s.d. {insight.period.to}
            {" · "}
            {new Date(insight.generatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
            {insight.cached ? " · dari cache" : ""}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-secondary italic">{AI_DISCLAIMER}</p>
    </div>
  );
}
