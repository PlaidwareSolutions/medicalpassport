"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, PillSpinner, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

interface RuleQualityRow {
  ruleKey: string;
  ruleVersion: string;
  raised: number;
  acknowledged: number;
  reviewedWithProfessional: number;
  dismissedNotRelevant: number;
  acknowledgementRate: number | null;
  falsePositiveRate: number | null;
  medianSecondsToAcknowledge: number | null;
}

interface RuleQualityResponse {
  from: string;
  to: string;
  totals: { raised: number; acknowledged: number; dismissedNotRelevant: number };
  items: RuleQualityRow[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)} %`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}

/**
 * Gate 3 alert-quality dashboard (docs_v2/06 P9-4, docs_v2/10 §4): per rule version, how
 * many findings were raised and what people did with them. The false-positive rate is
 * "dismissed as not relevant ÷ raised"; the acknowledgement rate is "acknowledged ÷
 * raised". Counts and rates only — no finding, no patient, no medicine — reviewed
 * monthly by the Safety Board (alert-fatigue review).
 */
export default function RulesQualityPage() {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [data, setData] = useState<RuleQualityResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const query = new URLSearchParams({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` });
      setData(await api.get<RuleQualityResponse>(`/admin/rules/quality?${query.toString()}`));
    } catch {
      setError("Couldn't load the dashboard. Check the dates and try again.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
    // Load once on mount; the button re-queries with the chosen window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: TableColumn<RuleQualityRow>[] = [
    { key: "ruleKey", header: "Rule", render: (r) => r.ruleKey },
    { key: "ruleVersion", header: "Version", render: (r) => r.ruleVersion },
    { key: "raised", header: "Raised", render: (r) => r.raised },
    { key: "acknowledged", header: "Acknowledged", render: (r) => r.acknowledged },
    { key: "reviewed", header: "Reviewed with professional", render: (r) => r.reviewedWithProfessional },
    { key: "dismissed", header: "Dismissed as not relevant", render: (r) => r.dismissedNotRelevant },
    { key: "ackRate", header: "Acknowledgement rate", render: (r) => pct(r.acknowledgementRate) },
    { key: "fpRate", header: "False-positive rate", render: (r) => pct(r.falsePositiveRate) },
    { key: "median", header: "Median time to acknowledge", render: (r) => duration(r.medianSecondsToAcknowledge) },
  ];

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "var(--font-title)" }}>Alert quality (Gate 3)</h1>
        <Link href="/rules">
          <Button variant="secondary">Rule versions</Button>
        </Link>
      </div>
      <p style={{ color: "var(--color-text-muted)" }}>
        Per rule version: findings raised in the window and what people did with them. False-positive rate = dismissed as not relevant ÷ raised;
        acknowledgement rate = acknowledged ÷ raised. Counts only — no patient, finding or medicine is shown here.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "var(--space-sm)", alignItems: "end", margin: "var(--space-md) 0" }}>
        <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button loading={loading} disabled={loading} onClick={() => void load()}>
          Update
        </Button>
      </div>
      {error ? <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p> : null}
      {data ? (
        <p data-testid="rules-quality-totals" style={{ color: "var(--color-text-muted)" }}>
          {data.totals.raised} raised · {data.totals.acknowledged} acknowledged · {data.totals.dismissedNotRelevant} dismissed as not relevant
          {" · "}
          {new Date(data.from).toLocaleDateString()} – {new Date(data.to).toLocaleDateString()}
        </p>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <Table
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => `${r.ruleKey}@${r.ruleVersion}`}
          emptyLabel={data === undefined && !error ? <PillSpinner label="Loading…" /> : "No findings were raised in this window"}
        />
      </div>
    </AdminShell>
  );
}
