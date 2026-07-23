"use client";
import { useEffect, useState } from "react";
import { Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

interface ChangeRow {
  id: string;
  entityType: string;
  operation: string;
  status: string;
  isSoloApproval: boolean;
  createdAt: string;
  requestedByAdminUser: { email: string };
}

export default function CatalogChangesPage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "">("pending");
  const [rows, setRows] = useState<ChangeRow[]>([]);

  useEffect(() => {
    api
      .get<{ items: ChangeRow[] }>(`/admin/catalog-changes${status ? `?status=${status}` : ""}`)
      .then((res) => setRows(res.items))
      .catch(() => setRows([]));
  }, [status]);

  const columns: TableColumn<ChangeRow>[] = [
    { key: "entityType", header: "Entity", render: (r) => r.entityType },
    { key: "operation", header: "Operation", render: (r) => r.operation },
    { key: "requestedBy", header: "Requested by", render: (r) => r.requestedByAdminUser.email },
    { key: "status", header: "Status", render: (r) => (r.status === "approved" && r.isSoloApproval ? "approved (solo)" : r.status) },
    { key: "createdAt", header: "Requested", render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Catalog change queue</h1>
      <div style={{ display: "flex", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
        {(["pending", "approved", "rejected", ""] as const).map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatus(s)}
            style={{
              padding: "var(--space-xs) var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: status === s ? "var(--color-primary)" : "transparent",
              color: status === s ? "var(--color-primary-contrast)" : "var(--color-text)",
              cursor: "pointer",
            }}
          >
            {s || "all"}
          </button>
        ))}
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyLabel="No changes"
        onRowClick={(r) => {
          window.location.href = `/catalog/changes/${r.id}`;
        }}
      />
    </AdminShell>
  );
}
