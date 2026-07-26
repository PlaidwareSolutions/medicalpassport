"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, PillSpinner, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../../components/AdminShell";
import { api } from "../../../../lib/api";

interface ChangeDetail {
  id: string;
  entityType: string;
  operation: string;
  status: string;
  proposedData: Record<string, unknown>;
  isSoloApproval: boolean;
  rejectionReason: string | null;
  requestedByAdminUser: { email: string };
  decidedByAdminUser: { email: string } | null;
  decidedAt: string | null;
}

export default function CatalogChangeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [change, setChange] = useState<ChangeDetail | undefined>();
  const [rejectionReason, setRejectionReason] = useState("");
  const [busyDecision, setBusyDecision] = useState<"approve" | "reject" | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function load() {
    const res = await api.get<ChangeDetail>(`/admin/catalog-changes/${params.id}`);
    setChange(res);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function decide(decision: "approve" | "reject") {
    setBusyDecision(decision);
    setError(undefined);
    try {
      await api.post(`/admin/catalog-changes/${params.id}/decide`, { decision, rejectionReason: decision === "reject" ? rejectionReason : undefined });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusyDecision(undefined);
    }
  }

  if (!change) {
    return (
      <AdminShell>
        <PillSpinner label="Loading…" />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <Button variant="ghost" onClick={() => router.replace("/catalog/changes")}>← Back to queue</Button>
      <h1 style={{ fontSize: "var(--font-title)" }}>
        {change.operation} {change.entityType}
      </h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <dl>
        <dt style={{ fontWeight: 600 }}>Status</dt>
        <dd>{change.status === "approved" && change.isSoloApproval ? "approved (solo — only one admin existed)" : change.status}</dd>
        <dt style={{ fontWeight: 600 }}>Requested by</dt>
        <dd>{change.requestedByAdminUser.email}</dd>
        {change.decidedByAdminUser ? (
          <>
            <dt style={{ fontWeight: 600 }}>Decided by</dt>
            <dd>{change.decidedByAdminUser.email}</dd>
          </>
        ) : null}
        {change.rejectionReason ? (
          <>
            <dt style={{ fontWeight: 600 }}>Rejection reason</dt>
            <dd>{change.rejectionReason}</dd>
          </>
        ) : null}
      </dl>

      <h2 style={{ fontSize: "var(--font-large)" }}>Proposed data</h2>
      <pre style={{ background: "var(--color-surface)", padding: "var(--space-md)", borderRadius: "var(--radius)", overflowX: "auto" }}>
        {JSON.stringify(change.proposedData, null, 2)}
      </pre>

      {change.status === "pending" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-lg)" }}>
          <Button loading={busyDecision === "approve"} disabled={busyDecision !== undefined} onClick={() => void decide("approve")}>
            Approve
          </Button>
          <TextInput label="Rejection reason (optional)" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
          <Button variant="danger" loading={busyDecision === "reject"} disabled={busyDecision !== undefined} onClick={() => void decide("reject")}>
            Reject
          </Button>
        </div>
      ) : null}
    </AdminShell>
  );
}
