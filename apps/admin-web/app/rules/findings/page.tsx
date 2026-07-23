"use client";
import { useState } from "react";
import { Button, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

interface FindingRow {
  id: string;
  category: string;
  severity: string;
  status: string;
  ruleKey: string;
  patientProfileId: string;
  evaluatedAt: string;
}

export default function FindingsPage() {
  const [filters, setFilters] = useState({ status: "", severity: "", category: "", ruleKey: "", patientProfileId: "" });
  const [rows, setRows] = useState<FindingRow[]>([]);
  const [loading, setLoading] = useState(false);

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  async function search() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
      const res = await api.get<{ items: FindingRow[] }>(`/admin/findings?${query.toString()}`);
      setRows(res.items);
    } finally {
      setLoading(false);
    }
  }

  const columns: TableColumn<FindingRow>[] = [
    { key: "evaluatedAt", header: "When", render: (r) => new Date(r.evaluatedAt).toLocaleString() },
    { key: "category", header: "Category", render: (r) => r.category },
    { key: "severity", header: "Severity", render: (r) => r.severity },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "ruleKey", header: "Rule", render: (r) => r.ruleKey },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Findings</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
        <TextInput label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} />
        <TextInput label="Severity" value={filters.severity} onChange={(e) => setFilter("severity", e.target.value)} />
        <TextInput label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)} />
        <TextInput label="Rule key" value={filters.ruleKey} onChange={(e) => setFilter("ruleKey", e.target.value)} />
        <TextInput label="Profile ID" value={filters.patientProfileId} onChange={(e) => setFilter("patientProfileId", e.target.value)} />
      </div>
      <Button disabled={loading} onClick={() => void search()}>Search</Button>
      <div style={{ marginTop: "var(--space-md)" }}>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyLabel={loading ? "Loading…" : "No matching findings"}
          onRowClick={(r) => {
            window.location.href = `/rules/findings/${r.id}`;
          }}
        />
      </div>
    </AdminShell>
  );
}
