"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

const KIND_LABELS: Record<string, string> = {
  education: "Commonly used for",
  storage: "Storage",
  warning_symptoms: "Warning symptoms",
  food_alcohol: "Food & alcohol",
  missed_dose: "Missed dose",
};

interface VersionDetail {
  id: string;
  body: string;
  sourceKind: string;
  sourceCitation: string;
  sourceUrl: string | null;
  lowConfidence: boolean;
  reviewStatus: string;
  isSoloApproval: boolean;
  rejectionReason: string | null;
  createdAt: string;
  proposedByAdminUser: { email: string } | null;
  decidedByAdminUser: { email: string } | null;
  decidedAt: string | null;
}

interface ContentDetail {
  id: string;
  kind: string;
  ingredient: { id: string; name: string };
  currentVersion: VersionDetail | null;
  versions: VersionDetail[];
}

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [content, setContent] = useState<ContentDetail | undefined>();
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [busyVersionId, setBusyVersionId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function load() {
    const res = await api.get<ContentDetail>(`/admin/content/${params.id}`);
    setContent(res);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function decide(versionId: string, decision: "approve" | "reject") {
    setBusyVersionId(versionId);
    setError(undefined);
    try {
      await api.post(`/admin/content/versions/${versionId}/decide`, {
        decision,
        rejectionReason: decision === "reject" ? rejectionReasons[versionId] : undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusyVersionId(undefined);
    }
  }

  if (!content) {
    return (
      <AdminShell>
        <p>Loading…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <Button variant="ghost" onClick={() => router.replace("/content")}>← Back to content</Button>
      <h1 style={{ fontSize: "var(--font-title)" }}>
        {content.ingredient.name} — {KIND_LABELS[content.kind] ?? content.kind}
      </h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <SectionTitle>Currently shown to patients</SectionTitle>
      {content.currentVersion ? (
        <Card>
          <p>{content.currentVersion.body}</p>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {content.currentVersion.sourceCitation}
            {content.currentVersion.decidedAt ? ` — reviewed ${new Date(content.currentVersion.decidedAt).toLocaleDateString()}` : ""}
          </span>
        </Card>
      ) : (
        <Card tone="warning">
          <span style={{ color: "var(--color-text-muted)" }}>Nothing approved yet — patients see the standard "not available" fallback for this ingredient.</span>
        </Card>
      )}

      <SectionTitle>Version history</SectionTitle>
      {content.versions.map((v) => (
        <Card key={v.id} tone={v.reviewStatus === "approved" ? "default" : v.reviewStatus === "rejected" ? "danger" : "warning"}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>
              {v.reviewStatus}
              {v.lowConfidence ? (
                <span style={{ color: "var(--color-warning)", marginLeft: "var(--space-sm)", fontWeight: 400 }}>
                  ⚠ Low confidence — keyword-extracted, not a clean section grab
                </span>
              ) : null}
            </strong>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{new Date(v.createdAt).toLocaleString()}</span>
          </div>
          <p>{v.body}</p>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {v.sourceKind === "daily_med" ? "openFDA/DailyMed (system-drafted)" : `Manually authored${v.proposedByAdminUser ? ` by ${v.proposedByAdminUser.email}` : ""}`}
            {" — "}
            {v.sourceCitation}
          </span>
          {v.decidedByAdminUser ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              Decided by {v.decidedByAdminUser.email}
              {v.isSoloApproval ? " (solo — only one admin existed)" : ""}
            </div>
          ) : null}
          {v.rejectionReason ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Reason: {v.rejectionReason}</div> : null}

          {v.reviewStatus === "draft" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              <Button disabled={busyVersionId === v.id} onClick={() => void decide(v.id, "approve")}>
                Approve — show to patients
              </Button>
              <TextInput
                label="Rejection reason (optional)"
                value={rejectionReasons[v.id] ?? ""}
                onChange={(e) => setRejectionReasons((r) => ({ ...r, [v.id]: e.target.value }))}
              />
              <Button variant="danger" disabled={busyVersionId === v.id} onClick={() => void decide(v.id, "reject")}>
                Reject
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </AdminShell>
  );
}
