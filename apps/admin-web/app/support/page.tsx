"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Card, Chip, PillSpinner, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import {
  SUPPORT_CASE_CHANNELS,
  SUPPORT_CASE_STATUSES,
  errorText,
  shortId,
  supportStatusTone,
  useHasDuty,
  when,
  type Page,
  type SupportCaseRow,
  type SupportCaseStatus,
} from "../../lib/platform";

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
 * Support cases (support_cases duty, docs_v2/14 §3 and §5). A case points
 * at a patient by opaque profile id only — this queue never shows a name,
 * a phone or anything clinical. Break-glass requests live on the detail page.
 */
export default function SupportCasesPage() {
  const allowed = useHasDuty("support_cases");
  const router = useRouter();
  const [status, setStatus] = useState<SupportCaseStatus | "">("open");
  const [page, setPage] = useState<(Page<SupportCaseRow> & { totals: Record<string, number> }) | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<string>("in_app");
  const [profileId, setProfileId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (status) params.set("status", status);
        if (cursor) params.set("cursor", cursor);
        const res = await api.get<Page<SupportCaseRow> & { totals: Record<string, number> }>(`/admin/support-cases?${params.toString()}`);
        setPage((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function create() {
    setCreating(true);
    setError(undefined);
    try {
      const created = await api.post<SupportCaseRow>("/admin/support-cases", {
        subject: subject.trim(),
        channel,
        patientProfileId: profileId.trim() || null,
      });
      router.push(`/support/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setCreating(false);
    }
  }

  const columns: TableColumn<SupportCaseRow>[] = [
    { key: "created", header: "Opened", render: (r) => when(r.createdAt) },
    { key: "subject", header: "Subject", render: (r) => r.subject },
    { key: "status", header: "Status", render: (r) => <Chip tone={supportStatusTone(r.status)}>{r.status}</Chip> },
    { key: "channel", header: "Channel", render: (r) => r.channel },
    { key: "profile", header: "Profile", render: (r) => (r.patientProfileId ? <code>{shortId(r.patientProfileId)}</code> : "—") },
    { key: "assigned", header: "Assignee", render: (r) => (r.assignedAdminId ? <code>{shortId(r.assignedAdminId)}</code> : "—") },
    { key: "notes", header: "Notes", render: (r) => r.noteCount ?? 0 },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Support cases</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the support_cases duty.</Banner>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            Cases point at a patient by opaque profile id. Nothing clinical is visible here; a time-boxed, audited break-glass grant is the only path to a
            record and it is requested from the case.
          </p>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", margin: "var(--space-md) 0", flexWrap: "wrap" }}>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SupportCaseStatus | "")} style={selectStyle}>
              <option value="">All statuses</option>
              {SUPPORT_CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s} {page?.totals[s] !== undefined ? `(${page.totals[s]})` : ""}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "Close" : "New case"}
            </Button>
          </div>
          {showCreate ? (
            <Card tone="info">
              <TextInput label="Subject (operational — no clinical detail)" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span>Channel</span>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} style={selectStyle}>
                  {SUPPORT_CASE_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <TextInput label="Patient profile id (optional, opaque)" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
              <Button loading={creating} disabled={subject.trim().length < 3} onClick={() => void create()}>
                Open case
              </Button>
            </Card>
          ) : null}
          <div style={{ marginTop: "var(--space-md)" }}>
            <Table
              columns={columns}
              rows={page?.items ?? []}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/support/${r.id}`)}
              emptyLabel={loading ? <PillSpinner label="Loading…" /> : "No cases"}
            />
          </div>
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
