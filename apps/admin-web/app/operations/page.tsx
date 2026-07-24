"use client";
import { useEffect, useState } from "react";
import { Banner, Button, Card, SectionTitle } from "@medpass/ui-web";
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
        <p>Loading…</p>
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

          <SectionTitle>Medicines tracked across all patients</SectionTitle>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            Aggregate counts only — never a patient name, profile, or medicine name. This is deliberately the only
            admin-visible information about patients&apos; medicine lists.
          </span>
          {!medStats ? (
            <p>Loading…</p>
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
