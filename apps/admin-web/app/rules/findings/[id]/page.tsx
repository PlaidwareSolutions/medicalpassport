"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, SectionTitle } from "@medpass/ui-web";
import { AdminShell } from "../../../../components/AdminShell";
import { api } from "../../../../lib/api";

interface FindingDetail {
  id: string;
  category: string;
  severity: string;
  status: string;
  ruleKey: string;
  ruleVersion: string;
  sourceName: string;
  detail: Record<string, unknown> | null;
  evaluatedAt: string;
  actions: Array<{ id: string; action: string; note: string | null; actorUserId: string; occurredAt: string }>;
  evaluation: { id: string; trigger: string; appVersion: string; inputSnapshot: unknown; startedAt: string; completedAt: string | null };
}

/** Full traceability view (docs/23 E7.4: source/version/rule/app/time/input persisted immutably). */
export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const [finding, setFinding] = useState<FindingDetail | undefined>();

  useEffect(() => {
    api.get<FindingDetail>(`/admin/findings/${params.id}`).then(setFinding);
  }, [params.id]);

  if (!finding) {
    return (
      <AdminShell>
        <p>Loading…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>{finding.category}</h1>
      <Card>
        <div>Severity: {finding.severity}</div>
        <div>Status: {finding.status}</div>
        <div>Rule: {finding.ruleKey} (v{finding.ruleVersion})</div>
        <div>Source: {finding.sourceName}</div>
        <div>Evaluated: {new Date(finding.evaluatedAt).toLocaleString()}</div>
      </Card>

      <SectionTitle>Finding detail</SectionTitle>
      <pre style={{ background: "var(--color-surface)", padding: "var(--space-md)", borderRadius: "var(--radius)", overflowX: "auto" }}>
        {JSON.stringify(finding.detail, null, 2)}
      </pre>

      <SectionTitle>Evaluation traceability</SectionTitle>
      <Card>
        <div>Trigger: {finding.evaluation.trigger}</div>
        <div>App version: {finding.evaluation.appVersion}</div>
        <div>Started: {new Date(finding.evaluation.startedAt).toLocaleString()}</div>
        <div>Completed: {finding.evaluation.completedAt ? new Date(finding.evaluation.completedAt).toLocaleString() : "—"}</div>
      </Card>
      <pre style={{ background: "var(--color-surface)", padding: "var(--space-md)", borderRadius: "var(--radius)", overflowX: "auto" }}>
        {JSON.stringify(finding.evaluation.inputSnapshot, null, 2)}
      </pre>

      <SectionTitle>Action history</SectionTitle>
      {finding.actions.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No actions recorded yet.</p>
      ) : (
        finding.actions.map((a) => (
          <Card key={a.id}>
            <div>{a.action}</div>
            {a.note ? <div style={{ color: "var(--color-text-muted)" }}>{a.note}</div> : null}
            <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>{new Date(a.occurredAt).toLocaleString()}</div>
          </Card>
        ))
      )}
    </AdminShell>
  );
}
