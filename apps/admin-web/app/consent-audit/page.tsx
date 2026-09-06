"use client";
import { useState } from "react";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, shortId, useHasDuty, when, type ConsentAudit } from "../../lib/platform";

/**
 * Consent audit (audit_search, docs_v2/14 §3): Consent + ConsentEvent and
 * ABDM consent artefact timelines for one opaque profile id. Types,
 * purposes, statuses and instants only; every lookup is audited against
 * the profile.
 */
export default function ConsentAuditPage() {
  const allowed = useHasDuty("audit_search");
  const [profileId, setProfileId] = useState("");
  const [data, setData] = useState<ConsentAudit | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function search() {
    setLoading(true);
    setError(undefined);
    try {
      setData(await api.get<ConsentAudit>(`/admin/consent-audit?profileId=${encodeURIComponent(profileId.trim())}`));
    } catch (err) {
      setData(undefined);
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  const timelineColumns: TableColumn<ConsentAudit["timeline"][number]>[] = [
    { key: "at", header: "When", render: (r) => when(r.at) },
    { key: "source", header: "Source", render: (r) => <Chip tone={r.source === "abdm" ? "warning" : "default"}>{r.source}</Chip> },
    { key: "type", header: "Type / purpose", render: (r) => r.type },
    { key: "event", header: "Event", render: (r) => r.event },
    { key: "actor", header: "Actor", render: (r) => r.actorType },
    { key: "id", header: "Id", render: (r) => <code>{shortId(r.id)}</code> },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Consent audit</h1>
      {!allowed ? (
        <Banner tone="warning">Your account does not hold the audit_search duty.</Banner>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>Search by opaque profile id. Each lookup is written to the audit chain against that profile.</p>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end", margin: "var(--space-md) 0" }}>
            <div style={{ flex: 1 }}>
              <TextInput label="Profile id" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
            </div>
            <Button loading={loading} disabled={!/^[0-9a-f-]{36}$/i.test(profileId.trim())} onClick={() => void search()}>
              Search
            </Button>
          </div>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {loading ? <PillSpinner label="Loading…" /> : null}
          {data ? (
            <>
              {data.profileDeleted ? <Banner tone="warning">This profile has been deleted; the consent history is retained for the legal basis record.</Banner> : null}
              <SectionTitle>Consents ({data.consents.length})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {data.consents.map((c) => (
                  <Card key={c.id}>
                    <span>
                      <strong>{c.type}</strong> <Chip tone={c.status === "active" ? "success" : "default"}>{c.status}</Chip>
                    </span>
                    <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                      {c.purpose} · granted {when(c.grantedAt)}
                      {c.expiresAt ? ` · expires ${when(c.expiresAt)}` : ""}
                      {c.revokedAt ? ` · revoked ${when(c.revokedAt)}` : ""}
                    </span>
                    <span style={{ fontSize: "var(--font-small)" }}>{c.events.map((e) => `${e.event} (${when(e.occurredAt)})`).join(" → ") || "no events"}</span>
                  </Card>
                ))}
                {data.consents.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No consents.</span> : null}
              </div>
              <SectionTitle>ABDM consent artefacts ({data.abdmConsents.length})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {data.abdmConsents.map((a) => (
                  <Card key={a.id}>
                    <span>
                      <strong>{a.purposeCode}</strong> <Chip tone={a.status === "granted" ? "success" : a.status === "revoked" ? "danger" : "default"}>{a.status}</Chip>
                    </span>
                    <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                      HI types: {a.hiTypes.join(", ") || "—"} · range {a.dateRangeFrom ? when(a.dateRangeFrom) : "—"} → {a.dateRangeTo ? when(a.dateRangeTo) : "—"} · erase{" "}
                      {a.dataEraseAt ? when(a.dataEraseAt) : "—"}
                    </span>
                  </Card>
                ))}
                {data.abdmConsents.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No ABDM artefacts.</span> : null}
              </div>
              <SectionTitle>Timeline</SectionTitle>
              <Table columns={timelineColumns} rows={data.timeline} rowKey={(r) => `${r.source}:${r.id}:${r.event}:${r.at}`} emptyLabel="No events" />
            </>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
