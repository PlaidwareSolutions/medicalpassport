"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";
import {
  SUPPORT_CASE_STATUSES,
  errorText,
  shortId,
  supportStatusTone,
  useHasDuty,
  when,
  type BreakGlassGrant,
  type SupportCaseDetail,
  type SupportCaseStatus,
} from "../../../lib/platform";

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

/**
 * One support case: status, notes, and the break-glass request form
 * (reason, minutes ≤ 60, current authenticator code). The grant is the
 * whole of what break-glass does today — it opens no clinical view here;
 * it is time-boxed, on the audit chain, and the patient is notified.
 */
export default function SupportCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useHasDuty("support_cases");
  const canBreakGlass = useHasDuty("audit_search");
  const [detail, setDetail] = useState<SupportCaseDetail | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"note" | "status" | "grant" | undefined>();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [totpCode, setTotpCode] = useState("");

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setDetail(await api.get<SupportCaseDetail>(`/admin/support-cases/${id}`));
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function addNote() {
    setBusy("note");
    setError(undefined);
    try {
      await api.post(`/admin/support-cases/${id}/notes`, { body: note.trim() });
      setNote("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function setStatus(status: SupportCaseStatus) {
    setBusy("status");
    setError(undefined);
    try {
      await api.patch(`/admin/support-cases/${id}`, { status });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function requestBreakGlass() {
    if (!detail?.patientProfileId) return;
    setBusy("grant");
    setError(undefined);
    setNotice(undefined);
    try {
      const grant = await api.post<BreakGlassGrant>("/admin/break-glass", {
        profileId: detail.patientProfileId,
        reason: reason.trim(),
        minutes: Number(minutes),
        supportCaseId: detail.id,
        totpCode: totpCode.trim(),
      });
      setNotice(`Break-glass granted until ${when(grant.expiresAt)}. The patient has been notified and the grant is on the audit chain.`);
      setReason("");
      setTotpCode("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <AdminShell>
      <Link href="/support" style={{ color: "var(--color-primary)" }}>
        ← Support cases
      </Link>
      {!canManage ? (
        <Banner tone="warning">Your account does not hold the support_cases duty.</Banner>
      ) : !detail ? (
        error ? (
          <Banner tone="danger">{error}</Banner>
        ) : (
          <PillSpinner label="Loading…" />
        )
      ) : (
        <>
          <h1 style={{ fontSize: "var(--font-title)", marginBottom: "var(--space-xs)" }}>{detail.subject}</h1>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
            <Chip tone={supportStatusTone(detail.status)}>{detail.status}</Chip>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {detail.channel} · opened {when(detail.createdAt)} · profile {detail.patientProfileId ? <code>{shortId(detail.patientProfileId)}</code> : "—"}
            </span>
          </div>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {notice ? <Banner tone="success">{notice}</Banner> : null}

          <SectionTitle>Status</SectionTitle>
          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            {SUPPORT_CASE_STATUSES.map((s) => (
              <Button key={s} variant={detail.status === s ? "primary" : "secondary"} disabled={detail.status === s} loading={busy === "status"} onClick={() => void setStatus(s)}>
                {s}
              </Button>
            ))}
          </div>

          <SectionTitle>Notes</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {detail.notes.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No notes yet.</span> : null}
            {detail.notes.map((n) => (
              <Card key={n.id}>
                <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {when(n.createdAt)} · admin <code>{shortId(n.authorAdminId)}</code>
                </span>
              </Card>
            ))}
            <Card>
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span>Add a note (operational only — never a clinical value)</span>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...selectStyle, padding: "var(--space-sm)" }} />
              </label>
              <Button loading={busy === "note"} disabled={note.trim().length === 0} onClick={() => void addNote()}>
                Add note
              </Button>
            </Card>
          </div>

          <SectionTitle>Break-glass</SectionTitle>
          {detail.breakGlassGrants.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
              {detail.breakGlassGrants.map((g) => (
                <Card key={g.id} tone={g.active ? "warning" : "default"}>
                  <span>
                    <Chip tone={g.active ? "warning" : "default"}>{g.active ? "active" : g.revokedAt ? "revoked" : "expired"}</Chip> admin <code>{shortId(g.adminUserId)}</code> · {when(g.grantedAt)} → {when(g.expiresAt)}
                  </span>
                </Card>
              ))}
            </div>
          ) : null}
          {!detail.patientProfileId ? (
            <span style={{ color: "var(--color-text-muted)" }}>Attach a profile id to the case to request break-glass.</span>
          ) : !canBreakGlass ? (
            <Banner tone="info">Break-glass is granted by audit_search holders; ask the security-audit on-call to request it against this case.</Banner>
          ) : (
            <Card tone="danger">
              <strong>Request time-boxed record access</strong>
              <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                Reason required, at most 60 minutes, your current authenticator code. Written to the audit chain against the patient; the patient is told.
                This grant does not open any clinical view in this portal.
              </span>
              <TextInput label="Reason (at least 10 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <TextInput label="Minutes (1–60)" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              <TextInput label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
              <Button
                variant="danger"
                loading={busy === "grant"}
                disabled={reason.trim().length < 10 || !/^\d{6}$/.test(totpCode.trim()) || Number(minutes) < 1 || Number(minutes) > 60}
                onClick={() => void requestBreakGlass()}
              >
                Grant break-glass
              </Button>
            </Card>
          )}
        </>
      )}
    </AdminShell>
  );
}
