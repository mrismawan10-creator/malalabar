"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyticsSummaryResponse, ReportType } from "@malalabar/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminFetch, rupiah } from "@/lib/admin-api";
import { downloadAuthed } from "@/lib/download";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";
import { OrderHistorySection } from "./analytics-order-history";
import { AnalyticsInsight } from "./analytics-insight";

/**
 * Analytics dashboard (PRD 4.6.1, T6.4). Metrics and charts follow the
 * API_Contract §7 semantics: revenue = PAID payments, orders = non-rejected.
 */

type PeriodKey = "today" | "7d" | "this_month" | "last_month" | "custom";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Hari Ini" },
  { key: "7d", label: "7 Hari Terakhir" },
  { key: "this_month", label: "Bulan Ini" },
  { key: "last_month", label: "Bulan Lalu" },
  { key: "custom", label: "Custom" },
];

const CHART_COLORS = [
  "#16308C",
  "#7FC2F1",
  "#FFD23D",
  "#FF8FB8",
  "#2E9E5B",
  "#B6DFFA",
  "#E5484D",
  "#9BABC7",
];

const METHOD_LABEL: Record<string, string> = {
  CASH: "Tunai",
  CARD: "Kartu",
  ONLINE: "Online",
};

function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-ink-secondary">tidak ada pembanding</span>;
  }
  const up = value >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-success-ink" : "text-danger-ink"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="bg-surface-raised border border-surface-line rounded-lg p-4 shadow-hard-sm">
      <p className="text-xs font-medium text-ink-secondary uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      <div className="mt-1">
        <Delta value={delta} />
        <span className="ml-1 text-xs text-ink-secondary">vs periode sebelumnya</span>
      </div>
    </div>
  );
}

const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #C7E4FA",
};

export function AnalyticsDashboard() {
  const { token, ready, login, logout } = useStaffToken();
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const periodQuery = useMemo(() => {
    if (period === "custom") {
      return `period=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    }
    return `period=${period}`;
  }, [period, from, to]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<AnalyticsSummaryResponse>(
        `/admin/analytics/summary?${periodQuery}`,
        token,
      );
      setSummary(res);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat laporan");
    } finally {
      setLoading(false);
    }
  }, [token, periodQuery, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const hourData = useMemo(
    () =>
      (summary?.revenueByHour ?? []).map((row) => ({
        hour: String(row.hour).padStart(2, "0"),
        revenue: row.revenue,
      })),
    [summary],
  );

  const payData = useMemo(
    () =>
      (summary?.paymentBreakdown ?? []).map((row) => ({
        method: METHOD_LABEL[row.method] ?? row.method,
        amount: row.amount,
        count: row.count,
      })),
    [summary],
  );

  const exportReport = async (type: ReportType, format: "pdf" | "csv") => {
    const key = `${type}-${format}`;
    setExporting(key);
    setError(null);
    try {
      await downloadAuthed(
        `/admin/reports/${type}?format=${format}&${periodQuery}`,
        token,
        `${type}.${format}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengunduh laporan");
    } finally {
      setExporting(null);
    }
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Laporan & Analitik" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Laporan & Analitik</h1>
            <p className="text-sm text-ink-secondary">
              Penjualan, menu, dan riwayat order — ekspor PDF & CSV.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Period selector */}
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  period === p.key
                    ? "bg-primary text-white"
                    : "text-ink hover:bg-surface-hover"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-end gap-2 ml-auto">
              <label className="block">
                <span className="block text-xs font-medium text-ink-secondary mb-1">Dari</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-ink-secondary mb-1">Sampai</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => void load()}
                disabled={!from || !to}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
              >
                Terapkan
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        {loading && !summary ? (
          <div className="bg-surface-raised border border-surface-line rounded-lg p-8 text-center text-ink-secondary">
            Memuat laporan…
          </div>
        ) : summary ? (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                label="Total Revenue"
                value={rupiah(summary.totalRevenue)}
                delta={summary.comparison.revenueDelta}
              />
              <MetricCard
                label="Total Orders"
                value={String(summary.totalOrders)}
                delta={summary.comparison.ordersDelta}
              />
              <MetricCard
                label="Average Order Value"
                value={rupiah(summary.averageOrderValue)}
                delta={summary.comparison.aovDelta}
              />
            </div>

            <AnalyticsInsight
              token={token}
              request={period === "custom" ? { period, from, to } : { period }}
              ready={period !== "custom" || (Boolean(from) && Boolean(to))}
              onUnauthorized={logout}
            />

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="lg:col-span-2 bg-surface-raised border border-surface-line rounded-lg p-4">
                <h2 className="text-sm font-semibold text-ink mb-3">Pendapatan per Jam (WIB)</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#C7E4FA" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#5B7BB0" }} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: "#5B7BB0" }} width={64} tickFormatter={(v) => rupiah(Number(v))} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => rupiah(Number(v))} />
                      <Bar dataKey="revenue" name="Pendapatan" fill="#7FC2F1" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface-raised border border-surface-line rounded-lg p-4">
                <h2 className="text-sm font-semibold text-ink mb-3">Top 10 Item Terlaris</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={summary.topItems}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#C7E4FA" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={150}
                        tick={{ fontSize: 10, fill: "#5B7BB0" }}
                      />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="quantitySold" name="Terjual" fill="#16308C" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface-raised border border-surface-line rounded-lg p-4">
                <h2 className="text-sm font-semibold text-ink mb-3">Pendapatan per Kategori</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary.revenueByCategory}
                        dataKey="revenue"
                        nameKey="category"
                        outerRadius={80}
                      >
                        {summary.revenueByCategory.map((row, index) => (
                          <Cell
                            key={row.category}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => rupiah(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface-raised border border-surface-line rounded-lg p-4">
                <h2 className="text-sm font-semibold text-ink mb-3">Metode Pembayaran</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={payData}
                        dataKey="amount"
                        nameKey="method"
                        innerRadius={48}
                        outerRadius={80}
                      >
                        {payData.map((row, index) => (
                          <Cell
                            key={row.method}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => rupiah(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="lg:col-span-2 bg-surface-raised border border-surface-line rounded-lg p-4">
                <h2 className="text-sm font-semibold text-ink mb-3">Volume Order per Hari</h2>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={summary.orderVolumeByDay}
                      margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#C7E4FA" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#5B7BB0" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#5B7BB0" }} width={32} allowDecimals={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="count" name="Order" fill="#FFD23D" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Exports */}
            <div className="bg-surface-raised border border-surface-line rounded-lg p-4">
              <h2 className="text-sm font-semibold text-ink mb-3">
                Ekspor Laporan — periode terpilih
              </h2>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                {(
                  [
                    ["sales-summary", "Ringkasan Penjualan", ["pdf", "csv"]],
                    ["menu-performance", "Performa Menu", ["pdf", "csv"]],
                    ["payment-report", "Laporan Pembayaran", ["pdf", "csv"]],
                    ["order-history", "Riwayat Order", ["csv"]],
                  ] as Array<[ReportType, string, Array<"pdf" | "csv">]>
                ).map(([type, label, formats]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{label}</span>
                    {formats.map((format) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => void exportReport(type, format)}
                        disabled={exporting !== null}
                        className="px-3 py-1.5 rounded-lg bg-surface-sunken border border-surface-line text-sm font-semibold text-ink uppercase hover:bg-surface-hover disabled:opacity-40"
                      >
                        {exporting === `${type}-${format}` ? "…" : format}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* Order history */}
        <OrderHistorySection token={token} onUnauthorized={logout} />
      </div>
    </div>
  );
}
