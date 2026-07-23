"use client";
import { useState } from "react";
import { Button, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface AuditRow {
  id: string;
  seq: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  correlationId: string | null;
  occurredAt: string;
}

export default function AuditSearchPage() {
  const [filters, setFilters] = useState({ action: "", actorType: "", entityType: "", entityId: "", patientProfileId: "", correlationId: "" });
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  async function search(nextCursor?: string) {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
      if (nextCursor) query.set("cursor", nextCursor);
      const res = await api.get<{ items: AuditRow[]; nextCursor: string | null }>(`/admin/audit?${query.toString()}`);
      setRows((prev) => (nextCursor ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  const columns: TableColumn<AuditRow>[] = [
    { key: "occurredAt", header: "When", render: (r) => new Date(r.occurredAt).toLocaleString() },
    { key: "action", header: "Action", render: (r) => r.action },
    { key: "actorType", header: "Actor", render: (r) => r.actorType },
    { key: "entity", header: "Entity", render: (r) => (r.entityType ? `${r.entityType}:${r.entityId}` : "—") },
    { key: "correlationId", header: "Correlation", render: (r) => r.correlationId ?? "—" },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Audit search</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
        <TextInput label="Action" value={filters.action} onChange={(e) => setFilter("action", e.target.value)} />
        <TextInput label="Actor type" value={filters.actorType} onChange={(e) => setFilter("actorType", e.target.value)} />
        <TextInput label="Entity type" value={filters.entityType} onChange={(e) => setFilter("entityType", e.target.value)} />
        <TextInput label="Entity ID" value={filters.entityId} onChange={(e) => setFilter("entityId", e.target.value)} />
        <TextInput label="Profile ID" value={filters.patientProfileId} onChange={(e) => setFilter("patientProfileId", e.target.value)} />
        <TextInput label="Correlation ID" value={filters.correlationId} onChange={(e) => setFilter("correlationId", e.target.value)} />
      </div>
      <Button disabled={loading} onClick={() => void search()}>
        Search
      </Button>

      <div style={{ marginTop: "var(--space-md)" }}>
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel={loading ? "Loading…" : "No matching audit events"} />
      </div>
      {cursor ? (
        <div style={{ marginTop: "var(--space-sm)" }}>
          <Button variant="secondary" disabled={loading} onClick={() => void search(cursor)}>
            Load more
          </Button>
        </div>
      ) : null}
    </AdminShell>
  );
}
