"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

const KIND_LABELS: Record<string, string> = {
  education: "Commonly used for",
  storage: "Storage",
  warning_symptoms: "Warning symptoms",
  food_alcohol: "Food & alcohol",
  missed_dose: "Missed dose",
};

interface Subject {
  ingredient: { name: string } | null;
  product: { genericName: string; brand: { name: string } | null } | null;
}

function subjectLabel(s: Subject): string {
  if (s.ingredient) return `Ingredient: ${s.ingredient.name}`;
  if (s.product) return `Product: ${s.product.brand?.name ?? s.product.genericName} (combination)`;
  return "Unknown";
}

interface VersionRow {
  id: string;
  body: string;
  sourceKind: string;
  lowConfidence: boolean;
  reviewStatus: string;
  createdAt: string;
  content: { id: string; kind: string } & Subject;
}

interface ContentRow extends Subject {
  id: string;
  kind: string;
  currentVersion: { body: string; decidedAt: string | null } | null;
  _count: { versions: number };
}

/**
 * Two views on the same underlying data: the reviewer queue (draft versions
 * awaiting a decision — the actionable list) and all (ingredient, kind)
 * pairs that have ever had content proposed (docs/06, docs/13, docs/34 Gate
 * 6/OD-6). Nothing shown here is ever patient-visible until a
 * `content_approve` reviewer approves it.
 */
export default function ContentPage() {
  const [tab, setTab] = useState<"queue" | "all">("queue");
  const [queue, setQueue] = useState<VersionRow[]>([]);
  const [all, setAll] = useState<ContentRow[]>([]);

  useEffect(() => {
    api
      .get<{ items: VersionRow[] }>("/admin/content/versions?status=draft")
      .then((res) => setQueue(res.items))
      .catch(() => setQueue([]));
    api
      .get<{ items: ContentRow[] }>("/admin/content")
      .then((res) => setAll(res.items))
      .catch(() => setAll([]));
  }, []);

  const queueColumns: TableColumn<VersionRow>[] = [
    { key: "subject", header: "Subject", render: (r) => subjectLabel(r.content) },
    { key: "kind", header: "Kind", render: (r) => KIND_LABELS[r.content.kind] ?? r.content.kind },
    {
      key: "source",
      header: "Source",
      render: (r) => (
        <>
          {r.sourceKind === "daily_med" ? "openFDA/DailyMed (system-drafted)" : "Manually authored"}
          {r.lowConfidence ? (
            <span style={{ color: "var(--color-warning)", marginLeft: "var(--space-xs)" }} title="Extracted via keyword search, not a clean section grab — scrutinize the excerpt carefully">
              ⚠ Low confidence
            </span>
          ) : null}
        </>
      ),
    },
    { key: "body", header: "Proposed text", render: (r) => (r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body) },
    { key: "createdAt", header: "Drafted", render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  const allColumns: TableColumn<ContentRow>[] = [
    { key: "subject", header: "Subject", render: (r) => subjectLabel(r) },
    { key: "kind", header: "Kind", render: (r) => KIND_LABELS[r.kind] ?? r.kind },
    { key: "status", header: "Live content", render: (r) => (r.currentVersion ? "Approved — shown to patients" : "None approved yet") },
    { key: "pending", header: "Drafts awaiting review", render: (r) => String(r._count.versions) },
  ];

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "var(--font-title)" }}>Content</h1>
        <Link href="/content/new">
          <Button>Propose content manually</Button>
        </Link>
      </div>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        Nothing here reaches a patient until a qualified clinical reviewer approves it (docs/34 Gate 6/OD-6). Rows marked{" "}
        <span style={{ color: "var(--color-warning)" }}>⚠ Low confidence</span> were extracted via keyword search rather than a clean source
        section — scrutinize those excerpts more carefully.
      </p>

      <div style={{ display: "flex", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
        {(["queue", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "var(--space-xs) var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: tab === t ? "var(--color-primary)" : "transparent",
              color: tab === t ? "var(--color-primary-contrast)" : "var(--color-text)",
              cursor: "pointer",
            }}
          >
            {t === "queue" ? "Review queue" : "All content"}
          </button>
        ))}
      </div>

      {tab === "queue" ? (
        <Table
          columns={queueColumns}
          rows={queue}
          rowKey={(r) => r.id}
          emptyLabel="Nothing awaiting review"
          onRowClick={(r) => {
            window.location.href = `/content/${r.content.id}`;
          }}
        />
      ) : (
        <Table
          columns={allColumns}
          rows={all}
          rowKey={(r) => r.id}
          emptyLabel="No content proposed yet"
          onRowClick={(r) => {
            window.location.href = `/content/${r.id}`;
          }}
        />
      )}
    </AdminShell>
  );
}
