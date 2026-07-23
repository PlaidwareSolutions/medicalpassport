"use client";
import { useEffect, useState } from "react";
import { Banner, Button, SectionTitle, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface DlqRow {
  id: string;
  queue: string;
  originalJobId: string;
  attempts: number;
  errorDigest: string;
  failedAt: string;
  replayedAt: string | null;
}

export default function IncidentsPage() {
  const [rows, setRows] = useState<DlqRow[]>([]);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [shareLinkId, setShareLinkId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function load() {
    const res = await api.get<{ items: DlqRow[] }>("/admin/incidents/dlq?replayed=false");
    setRows(res.items);
  }

  useEffect(() => {
    void load();
  }, []);

  async function replay(id: string) {
    setBusyId(id);
    setError(undefined);
    try {
      await api.post(`/admin/jobs/${id}/replay`);
      await load();
    } catch {
      setError("Replay failed.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function revokeShare() {
    setError(undefined);
    setNotice(undefined);
    try {
      await api.post(`/admin/incidents/shares/${shareLinkId}/revoke`, { reason: revokeReason || undefined });
      setNotice("Share link revoked.");
      setShareLinkId("");
      setRevokeReason("");
    } catch {
      setError("Revoke failed — check the share link ID.");
    }
  }

  const columns: TableColumn<DlqRow>[] = [
    { key: "queue", header: "Queue", render: (r) => r.queue },
    { key: "failedAt", header: "Failed", render: (r) => new Date(r.failedAt).toLocaleString() },
    { key: "attempts", header: "Attempts", render: (r) => String(r.attempts) },
    { key: "error", header: "Error", render: (r) => r.errorDigest },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button variant="secondary" disabled={busyId === r.id} onClick={() => void replay(r.id)}>
          Replay
        </Button>
      ),
    },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Incidents</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <SectionTitle>Dead-letter queue (awaiting replay)</SectionTitle>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel="No outstanding dead-letter jobs" />

      <SectionTitle>Revoke a share link (abuse report — docs/30 R9)</SectionTitle>
      <TextInput label="Share link ID" value={shareLinkId} onChange={(e) => setShareLinkId(e.target.value)} />
      <TextInput label="Reason (optional)" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
      <div style={{ marginTop: "var(--space-sm)" }}>
        <Button variant="danger" disabled={!shareLinkId} onClick={() => void revokeShare()}>
          Revoke share
        </Button>
      </div>
    </AdminShell>
  );
}
