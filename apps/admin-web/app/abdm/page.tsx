"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Banner, Button, Card, Chip, PillSpinner, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, shortId, useHasDuty, when, type AbdmTransactionRow, type Page } from "../../lib/platform";

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

type Totals = { byStatus: Record<string, number>; byKind: Record<string, number> };

function statusTone(status: string): "default" | "success" | "warning" | "danger" {
  if (status === "completed" || status === "succeeded") return "success";
  if (status === "failed" || status === "error") return "danger";
  if (status === "pending" || status === "started") return "warning";
  return "default";
}

/**
 * ABDM transactions (abdm_operations, docs_v2/14 §3): the AbdmTransaction
 * ledger — kinds, statuses, gateway ids, error codes, timings. Bodies are
 * never stored, only digests; profile ids are opaque.
 */
export default function AbdmTransactionsPage() {
  const allowed = useHasDuty("abdm_operations");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [direction, setDirection] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [page, setPage] = useState<(Page<AbdmTransactionRow> & { totals: Totals }) | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (status) params.set("status", status);
        if (kind.trim()) params.set("kind", kind.trim());
        if (direction) params.set("direction", direction);
        if (errorsOnly) params.set("errorsOnly", "true");
        if (cursor) params.set("cursor", cursor);
        const res = await api.get<Page<AbdmTransactionRow> & { totals: Totals }>(`/admin/abdm/transactions?${params.toString()}`);
        setPage((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [status, kind, direction, errorsOnly],
  );

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const columns: TableColumn<AbdmTransactionRow>[] = [
    { key: "started", header: "Started", render: (r) => when(r.startedAt) },
    { key: "kind", header: "Kind", render: (r) => r.kind },
    { key: "direction", header: "Direction", render: (r) => r.direction },
    { key: "status", header: "Status", render: (r) => <Chip tone={statusTone(r.status)}>{r.status}</Chip> },
    { key: "env", header: "Gateway", render: (r) => r.gatewayEnv },
    { key: "ids", header: "Request / txn", render: (r) => `${shortId(r.requestId)} / ${shortId(r.transactionId)}` },
    { key: "profile", header: "Profile", render: (r) => (r.patientProfileId ? <code>{shortId(r.patientProfileId)}</code> : "—") },
    { key: "duration", header: "Duration", render: (r) => (r.durationMs !== null ? `${r.durationMs} ms` : "—") },
    { key: "error", header: "Error", render: (r) => (r.errorCode ? <span title={r.errorText ?? undefined}>{r.errorCode}</span> : "—") },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>ABDM transactions</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the abdm_operations duty.</Banner>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {page ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
              <Card>
                <strong>By status</strong>
                {Object.entries(page.totals.byStatus).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </Card>
              <Card>
                <strong>By kind</strong>
                {Object.entries(page.totals.byKind).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "var(--space-sm)", alignItems: "end", margin: "var(--space-md) 0" }}>
            <TextInput label="Status" value={status} onChange={(e) => setStatus(e.target.value)} />
            <TextInput label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} />
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <span>Direction</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={selectStyle}>
                <option value="">Any</option>
                <option value="outbound">outbound</option>
                <option value="inbound">inbound</option>
              </select>
            </label>
            <label style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center", minHeight: "var(--size-touch)" }}>
              <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only
            </label>
          </div>
          <Table columns={columns} rows={page?.items ?? []} rowKey={(r) => r.id} emptyLabel={loading ? <PillSpinner label="Loading…" /> : "No transactions"} />
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
