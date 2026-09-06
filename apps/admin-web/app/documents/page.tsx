"use client";
import { useEffect, useState } from "react";
import { Banner, Button, Card, PillSpinner, SectionTitle, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, useHasDuty, type DocumentsStatus } from "../../lib/platform";

function Breakdown({ title, breakdown }: { title: string; breakdown: Record<string, number> }) {
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

/**
 * Document processing (operations_view, docs_v2/14 §3): the funnel
 * uploaded → classified → extracted → confirmed over a trailing window,
 * with failures by engine. Counts only — never a title, a page or a value.
 */
export default function DocumentsStatusPage() {
  const allowed = useHasDuty("operations_view");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DocumentsStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!allowed) return;
    setData(undefined);
    api
      .get<DocumentsStatus>(`/admin/documents/status?days=${days}`)
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, [allowed, days]);

  const stages = data
    ? [
        { label: "Uploaded", value: data.funnel.uploaded },
        { label: "Classified", value: data.funnel.classified },
        { label: "Extracted", value: data.funnel.extracted },
        { label: "Confirmed", value: data.funnel.confirmed },
      ]
    : [];
  const max = Math.max(1, ...stages.map((s) => s.value));

  const failureColumns: TableColumn<DocumentsStatus["failuresByEngine"][number]>[] = [
    { key: "engine", header: "Engine", render: (r) => r.engine },
    { key: "version", header: "Version", render: (r) => r.engineVersion },
    { key: "count", header: "Failures", render: (r) => r.count },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Document processing</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the operations_view duty.</Banner>
      ) : (
        <>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", margin: "var(--space-md) 0" }}>
            <span>Window:</span>
            {[7, 30, 90].map((d) => (
              <Button key={d} variant={days === d ? "primary" : "secondary"} onClick={() => setDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {!data ? (
            <PillSpinner label="Loading…" />
          ) : (
            <>
              <SectionTitle>Funnel</SectionTitle>
              <Card>
                {stages.map((s, i) => {
                  const prev = i === 0 ? s.value : stages[i - 1]!.value;
                  const pct = prev > 0 ? Math.round((s.value / prev) * 100) : 0;
                  return (
                    <div key={s.label} style={{ display: "grid", gridTemplateColumns: "110px 1fr 80px 60px", alignItems: "center", gap: "var(--space-sm)" }}>
                      <span>{s.label}</span>
                      <div style={{ background: "var(--color-border)", borderRadius: "var(--radius-sm)", height: 14, overflow: "hidden" }}>
                        <div style={{ width: `${(s.value / max) * 100}%`, height: "100%", background: "var(--color-primary)" }} />
                      </div>
                      <strong style={{ textAlign: "right" }}>{s.value}</strong>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", textAlign: "right" }}>{i === 0 ? "" : `${pct}%`}</span>
                    </div>
                  );
                })}
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {data.pendingUpload} awaiting upload · {data.quarantined} quarantined{typeof data.malwareQuarantined === "number" ? ` (${data.malwareQuarantined} by malware scan)` : ""}
                </span>
              </Card>

              <SectionTitle>Failures by engine</SectionTitle>
              <Table columns={failureColumns} rows={data.failuresByEngine} rowKey={(r) => `${r.engine}@${r.engineVersion}`} emptyLabel="No extraction failures in this window" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
                <Breakdown title="By document status" breakdown={data.byStatus} />
                <Breakdown title="Classified by" breakdown={data.byClassifiedBy} />
                <Breakdown title="Candidates by status" breakdown={data.candidatesByStatus} />
              </div>
            </>
          )}
        </>
      )}
    </AdminShell>
  );
}
