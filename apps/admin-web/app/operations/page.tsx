"use client";
import { useEffect, useState } from "react";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface OperationsSummary {
  windowHours: number;
  jobFailuresInWindow: number;
  dlqAddedInWindow: number;
  dlqOutstanding: number;
  reminderPipeline: Record<string, number>;
  latestBackup: { id: string; status: string; completedAt: string | null } | null;
  latestRestoreTest: { id: string; status: string; completedAt: string | null } | null;
}

interface MedicationStats {
  totalMedicationsAllTime: number;
  totalActiveMedications: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byNormalizationStatus: Record<string, number>;
  byDoseUnit: Record<string, number>;
  prnCount: number;
  criticalEscalationCount: number;
  refillTrackedCount: number;
}

interface ProductMetrics {
  from: string;
  to: string;
  timezone: string;
  days: Array<{ date: string; counts: Record<string, number> }>;
  totals: Record<string, number>;
}

/**
 * Product metrics (docs_v2/06 P1-7, docs_v2/14 §6): counts per catalogue
 * event per day over the last week. Aggregate only — the table behind it
 * holds peppered digests, never an id, and this card never asks for one.
 */
function ProductMetricsCard({ metrics }: { metrics: ProductMetrics | undefined }) {
  if (!metrics) return <PillSpinner label="Loading…" />;
  const names = Object.keys(metrics.totals).sort();
  const dates = metrics.days.map((d) => d.date);
  return (
    <Card>
      <strong>Product events — last 7 days</strong>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        Counts per catalogue event per day ({metrics.timezone}). PHI-free by construction: no ids, no values.
      </span>
      {names.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)" }}>No product events in this window.</span>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "var(--space-sm)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-small)" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Event</th>
                {dates.map((date) => (
                  <th key={date} style={{ textAlign: "right", padding: "4px 8px", whiteSpace: "nowrap" }}>
                    {date.slice(5)}
                  </th>
                ))}
                <th style={{ textAlign: "right", padding: "4px 8px" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => (
                <tr key={name} data-testid="product-metric-row">
                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{name}</td>
                  {metrics.days.map((day) => (
                    <td key={day.date} style={{ textAlign: "right", padding: "4px 8px" }}>
                      {day.counts[name] ?? 0}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", padding: "4px 8px" }}>
                    <strong>{metrics.totals[name]}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BreakdownCard({ title, breakdown }: { title: string; breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown);
  return (
    <Card>
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)" }}>No data.</span>
      ) : (
        entries.map(([key, count]) => (
          <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{key}</span>
            <strong>{count}</strong>
          </div>
        ))
      )}
    </Card>
  );
}

export default function OperationsPage() {
  const [windowHours, setWindowHours] = useState(24);
  const [summary, setSummary] = useState<OperationsSummary | undefined>();
  const [medStats, setMedStats] = useState<MedicationStats | undefined>();
  const [productMetrics, setProductMetrics] = useState<ProductMetrics | undefined>();

  async function load() {
    const res = await api.get<OperationsSummary>(`/admin/operations/summary?windowHours=${windowHours}`);
    setSummary(res);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowHours]);

  useEffect(() => {
    void api.get<MedicationStats>("/admin/operations/medication-stats").then(setMedStats);
    // Defaults server-side to the last seven days.
    void api.get<ProductMetrics>("/admin/metrics/product").then(setProductMetrics);
  }, []);

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Operations</h1>
      <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", margin: "var(--space-md) 0" }}>
        <span>Window:</span>
        {[24, 72, 168].map((h) => (
          <Button key={h} variant={windowHours === h ? "primary" : "secondary"} onClick={() => setWindowHours(h)}>
            {h}h
          </Button>
        ))}
      </div>

      {!summary ? (
        <PillSpinner label="Loading…" />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)" }}>
            <Card>
              <strong>Job failures</strong>
              <span style={{ fontSize: "var(--font-large)" }}>{summary.jobFailuresInWindow}</span>
            </Card>
            <Card>
              <strong>DLQ added</strong>
              <span style={{ fontSize: "var(--font-large)" }}>{summary.dlqAddedInWindow}</span>
            </Card>
            <Card tone={summary.dlqOutstanding > 0 ? "warning" : "default"}>
              <strong>DLQ outstanding</strong>
              <span style={{ fontSize: "var(--font-large)" }}>{summary.dlqOutstanding}</span>
            </Card>
          </div>

          {summary.dlqOutstanding > 0 ? <Banner tone="warning">There are dead-letter jobs awaiting replay — see Incidents.</Banner> : null}

          <SectionTitle>Reminder pipeline (by channel/status)</SectionTitle>
          <Card>
            {Object.keys(summary.reminderPipeline).length === 0 ? (
              <span style={{ color: "var(--color-text-muted)" }}>No reminder attempts in this window.</span>
            ) : (
              Object.entries(summary.reminderPipeline).map(([key, count]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{key}</span>
                  <strong>{count}</strong>
                </div>
              ))
            )}
          </Card>

          <SectionTitle>Backups</SectionTitle>
          <Card tone={summary.latestBackup?.status === "succeeded" ? "default" : "danger"}>
            {summary.latestBackup ? (
              <span>
                Latest backup: {summary.latestBackup.status} ({summary.latestBackup.completedAt ? new Date(summary.latestBackup.completedAt).toLocaleString() : "in progress"})
              </span>
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>No backup executions recorded.</span>
            )}
          </Card>
          <Card tone={summary.latestRestoreTest && summary.latestRestoreTest.status === "failed" ? "danger" : "default"}>
            {summary.latestRestoreTest ? (
              <span>Latest restore test: {summary.latestRestoreTest.status}</span>
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>No restore tests recorded.</span>
            )}
          </Card>

          <SectionTitle>Product metrics</SectionTitle>
          <ProductMetricsCard metrics={productMetrics} />

          <SectionTitle>Medicines tracked across all patients</SectionTitle>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            Aggregate counts only — never a patient name, profile, or medicine name. This is deliberately the only
            admin-visible information about patients&apos; medicine lists.
          </span>
          {!medStats ? (
            <PillSpinner label="Loading…" />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <Card>
                  <strong>Active medications</strong>
                  <span style={{ fontSize: "var(--font-large)" }}>{medStats.totalActiveMedications}</span>
                </Card>
                <Card>
                  <strong>Total ever added</strong>
                  <span style={{ fontSize: "var(--font-large)" }}>{medStats.totalMedicationsAllTime}</span>
                </Card>
                <Card>
                  <strong>As-needed (PRN)</strong>
                  <span style={{ fontSize: "var(--font-large)" }}>{medStats.prnCount}</span>
                </Card>
                <Card>
                  <strong>Refill-tracked</strong>
                  <span style={{ fontSize: "var(--font-large)" }}>{medStats.refillTrackedCount}</span>
                </Card>
                <Card>
                  <strong>Critical escalation on</strong>
                  <span style={{ fontSize: "var(--font-large)" }}>{medStats.criticalEscalationCount}</span>
                </Card>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <BreakdownCard title="By status" breakdown={medStats.byStatus} />
                <BreakdownCard title="By source" breakdown={medStats.bySource} />
                <BreakdownCard title="By medicine type (dose unit)" breakdown={medStats.byDoseUnit} />
                <BreakdownCard title="By catalog match status" breakdown={medStats.byNormalizationStatus} />
              </div>
            </>
          )}
        </>
      )}
    </AdminShell>
  );
}
