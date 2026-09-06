"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Banner, Button, Card, Chip, PillSpinner, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, shortId, useHasDuty, when, type FhirFailureRow, type Page } from "../../lib/platform";

const selectStyle: CSSProperties = {
  minHeight: "var(--size-touch)",
  padding: "0 var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "2px solid var(--color-border)",
  fontSize: "var(--font-body)",
  fontFamily: "var(--font-family)",
  color: "var(--color-text)",
  background: "var(--color-bg)",
};

type Totals = { byResourceType: Record<string, number>; bySeverity: Record<string, number> };

/**
 * FHIR validation failures (fhir_view, docs_v2/14 §3): structural validator
 * findings by direction, IG version, resource type and path. Bundle ids
 * are opaque; messages name rules, never element values.
 */
export default function FhirFailuresPage() {
  const allowed = useHasDuty("fhir_view");
  const [direction, setDirection] = useState("");
  const [severity, setSeverity] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [page, setPage] = useState<(Page<FhirFailureRow> & { totals: Totals }) | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (direction) params.set("direction", direction);
        if (severity) params.set("severity", severity);
        if (resourceType.trim()) params.set("resourceType", resourceType.trim());
        if (cursor) params.set("cursor", cursor);
        const res = await api.get<Page<FhirFailureRow> & { totals: Totals }>(`/admin/fhir/validation-failures?${params.toString()}`);
        setPage((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [direction, severity, resourceType],
  );

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const columns: TableColumn<FhirFailureRow>[] = [
    { key: "when", header: "When", render: (r) => when(r.createdAt) },
    { key: "direction", header: "Direction", render: (r) => r.direction },
    { key: "ig", header: "IG", render: (r) => r.igVersion },
    { key: "resource", header: "Resource", render: (r) => r.resourceType },
    { key: "path", header: "Path", render: (r) => <code>{r.path}</code> },
    { key: "severity", header: "Severity", render: (r) => <Chip tone={r.severity === "error" || r.severity === "fatal" ? "danger" : "warning"}>{r.severity}</Chip> },
    { key: "message", header: "Message", render: (r) => r.message },
    { key: "bundle", header: "Bundle", render: (r) => <code>{shortId(r.bundleId)}</code> },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>FHIR validation failures</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the fhir_view duty.</Banner>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {page ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
              <Card>
                <strong>By severity</strong>
                {Object.entries(page.totals.bySeverity).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </Card>
              <Card>
                <strong>By resource type</strong>
                {Object.entries(page.totals.byResourceType).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-sm)", alignItems: "end", margin: "var(--space-md) 0" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <span>Direction</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={selectStyle}>
                <option value="">Any</option>
                <option value="outbound">outbound</option>
                <option value="inbound">inbound</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <span>Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={selectStyle}>
                <option value="">Any</option>
                {["fatal", "error", "warning", "information"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <TextInput label="Resource type" value={resourceType} onChange={(e) => setResourceType(e.target.value)} />
          </div>
          <Table columns={columns} rows={page?.items ?? []} rowKey={(r) => r.id} emptyLabel={loading ? <PillSpinner label="Loading…" /> : "No validation failures"} />
          {page?.nextCursor ? (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <Button variant="secondary" loading={loading} onClick={() => void load(page.nextCursor!)}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
