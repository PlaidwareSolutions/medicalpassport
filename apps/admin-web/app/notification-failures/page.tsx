"use client";
import { useEffect, useState } from "react";
import { Banner, Button, Card, PillSpinner, SectionTitle, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, useHasDuty, type NotificationFailures } from "../../lib/platform";

function Breakdown({ title, breakdown }: { title: string; breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown);
  return (
    <Card>
      <strong>{title}</strong>
      {entries.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)" }}>None.</span>
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
 * Notification failures (operations_view, docs_v2/14 §3 — split out of the
 * operations summary): failed attempts by channel and kind over the
 * window, with the most common error digests per channel. Aggregates only.
 */
export default function NotificationFailuresPage() {
  const allowed = useHasDuty("operations_view");
  const [days, setDays] = useState(7);
  const [data, setData] = useState<NotificationFailures | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!allowed) return;
    setData(undefined);
    api
      .get<NotificationFailures>(`/admin/notifications/failures?days=${days}`)
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, [allowed, days]);

  type AttemptRow = NotificationFailures["attemptsByChannelAndStatus"][number];
  const attemptColumns: TableColumn<AttemptRow>[] = [
    { key: "channel", header: "Channel", render: (r) => r.channel },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "count", header: "Attempts", render: (r) => r.count },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Notification failures</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the operations_view duty.</Banner>
      ) : (
        <>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", margin: "var(--space-md) 0" }}>
            <span>Window:</span>
            {[1, 7, 30].map((d) => (
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
              <Card tone={data.failedTotal > 0 ? "warning" : "default"}>
                <strong>Failed attempts</strong>
                <span style={{ fontSize: "var(--font-large)" }}>{data.failedTotal}</span>
              </Card>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                <Breakdown title="By channel" breakdown={data.byChannel} />
                <Breakdown title="By kind" breakdown={data.byKind} />
                <Breakdown title="Cancelled rows by kind (cap, off, undeliverable)" breakdown={data.cancelledByKind} />
              </div>
              <SectionTitle>Top errors per channel</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)" }}>
                {Object.entries(data.topErrors).map(([channel, errors]) => (
                  <Breakdown key={channel} title={channel} breakdown={Object.fromEntries(errors.map((e) => [e.errorDigest, e.count]))} />
                ))}
                {Object.keys(data.topErrors).length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No failures in this window.</span> : null}
              </div>
              <SectionTitle>All attempts by channel and status</SectionTitle>
              <Table columns={attemptColumns} rows={data.attemptsByChannelAndStatus} rowKey={(r) => `${r.channel}:${r.status}`} emptyLabel="No attempts in this window" />
            </>
          )}
        </>
      )}
    </AdminShell>
  );
}
