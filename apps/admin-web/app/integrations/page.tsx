"use client";
import { useEffect, useState } from "react";
import { Banner, Chip, PillSpinner, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, useHasDuty, when, type IntegrationRow } from "../../lib/platform";

function healthTone(h: IntegrationRow["health"]): "default" | "success" | "warning" | "danger" {
  if (h === "configured") return "success";
  if (h === "mock") return "warning";
  if (h === "not_configured") return "danger";
  return "default";
}

const HEALTH_LABEL: Record<IntegrationRow["health"], string> = {
  configured: "configured",
  mock: "mock / log only",
  not_configured: "not configured",
  none: "none",
};

/**
 * Integrations (operations_view, docs_v2/14 §3): one row per external
 * dependency with its version where known and the last success derived
 * from job / attempt / transaction rows. Configuration facts only — no
 * key material, no addresses.
 */
export default function IntegrationsPage() {
  const allowed = useHasDuty("operations_view");
  const [data, setData] = useState<{ items: IntegrationRow[]; generatedAt: string } | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!allowed) return;
    api
      .get<{ items: IntegrationRow[]; generatedAt: string }>("/admin/integrations")
      .then(setData)
      .catch((err) => setError(errorText(err)));
  }, [allowed]);

  const columns: TableColumn<IntegrationRow>[] = [
    { key: "label", header: "Adapter", render: (r) => r.label },
    { key: "health", header: "Health", render: (r) => <Chip tone={healthTone(r.health)}>{HEALTH_LABEL[r.health]}</Chip> },
    { key: "version", header: "Version", render: (r) => r.version ?? "—" },
    { key: "last", header: "Last success", render: (r) => (r.lastSuccessAt ? `${when(r.lastSuccessAt)} (${r.lastSuccessSource})` : "—") },
    { key: "note", header: "Note", render: (r) => <span style={{ color: "var(--color-text-muted)" }}>{r.note ?? ""}</span> },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Integrations</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the operations_view duty.</Banner>
      ) : error ? (
        <Banner tone="danger">{error}</Banner>
      ) : !data ? (
        <PillSpinner label="Loading…" />
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Generated {when(data.generatedAt)}.</p>
          <Table columns={columns} rows={data.items} rowKey={(r) => r.key} />
        </>
      )}
    </AdminShell>
  );
}
