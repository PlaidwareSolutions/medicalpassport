"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface VersionRow {
  id: string;
  body: string;
  sourceKind: string;
  reviewStatus: string;
  createdAt: string;
  content: { id: string; ingredient: { name: string } };
}

interface ContentRow {
  id: string;
  kind: string;
  ingredient: { name: string };
  currentVersion: { body: string; decidedAt: string | null } | null;
  _count: { versions: number };
}

/**
 * Two views on the same underlying data: the reviewer queue (draft versions
 * awaiting a decision — the actionable list) and all ingredients that have
 * ever had content proposed (docs/06, docs/13, docs/34 Gate 6/OD-6). Nothing
 * shown here is ever patient-visible until a `content_approve` reviewer
 * approves it.
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
    { key: "ingredient", header: "Ingredient", render: (r) => r.content.ingredient.name },
    { key: "source", header: "Source", render: (r) => (r.sourceKind === "daily_med" ? "openFDA/DailyMed (system-drafted)" : "Manually authored") },
    { key: "body", header: "Proposed text", render: (r) => (r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body) },
    { key: "createdAt", header: "Drafted", render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  const allColumns: TableColumn<ContentRow>[] = [
    { key: "ingredient", header: "Ingredient", render: (r) => r.ingredient.name },
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
        Nothing here reaches a patient until a qualified clinical reviewer approves it (docs/34 Gate 6/OD-6).
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
            {t === "queue" ? "Review queue" : "All ingredients"}
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
