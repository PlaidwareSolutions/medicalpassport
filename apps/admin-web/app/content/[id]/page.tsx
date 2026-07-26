"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

const KIND_LABELS: Record<string, string> = {
  education: "Commonly used for",
  storage: "Storage",
  warning_symptoms: "Warning symptoms",
  food_alcohol: "Food & alcohol",
  missed_dose: "Missed dose",
};

const LOCALE_LABELS: Record<string, string> = { hi: "Hindi", te: "Telugu", ur: "Urdu" };

interface TranslationDetail {
  id: string;
  locale: string;
  body: string;
  reviewStatus: string;
  isSoloApproval: boolean;
  rejectionReason: string | null;
  translatedByAdminUser: { email: string };
  decidedByAdminUser: { email: string } | null;
}

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
  translations: TranslationDetail[];
}

/** Propose/review translations for one already-approved version — its own local state, kept out of the parent's. */
function TranslationsPanel({ version, onChanged }: { version: VersionDetail; onChanged: () => void }) {
  const [locale, setLocale] = useState<"hi" | "te" | "ur">("hi");
  const [body, setBody] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function proposeTranslation() {
    setBusyId("new");
    setError(undefined);
    try {
      await api.post(`/admin/content/versions/${version.id}/translations`, { locale, body });
      setBody("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function decideTranslation(translationId: string, decision: "approve" | "reject") {
    setBusyId(`${translationId}:${decision}`);
    setError(undefined);
    try {
      await api.post(`/admin/content/translations/${translationId}/decide`, {
        decision,
        rejectionReason: decision === "reject" ? rejectionReasons[translationId] : undefined,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusyId(undefined);
    }
  }

  /** Either decision for this translation is in flight — disables both buttons; `loading` still keys to the one actually clicked. */
  function translationRowBusy(translationId: string): boolean {
    return busyId === `${translationId}:approve` || busyId === `${translationId}:reject`;
  }

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", marginTop: "var(--space-sm)", paddingTop: "var(--space-sm)" }}>
      <strong style={{ fontSize: "var(--font-small)" }}>Translations</strong>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {version.translations.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>No translations proposed yet.</p>
      ) : (
        version.translations.map((t) => (
          <Card key={t.id} tone={t.reviewStatus === "approved" ? "default" : t.reviewStatus === "rejected" ? "danger" : "warning"} style={{ marginTop: "var(--space-xs)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>
                {LOCALE_LABELS[t.locale] ?? t.locale} — {t.reviewStatus}
              </strong>
            </div>
            <p>{t.body}</p>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Translated by {t.translatedByAdminUser.email}</span>
            {t.decidedByAdminUser ? (
              <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                Decided by {t.decidedByAdminUser.email}
                {t.isSoloApproval ? " (solo — only one admin existed)" : ""}
              </div>
            ) : null}
            {t.rejectionReason ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Reason: {t.rejectionReason}</div> : null}
            {t.reviewStatus === "draft" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}>
                <Button loading={busyId === `${t.id}:approve`} disabled={translationRowBusy(t.id)} onClick={() => void decideTranslation(t.id, "approve")}>
                  Approve translation
                </Button>
                <TextInput
                  label="Rejection reason (optional)"
                  value={rejectionReasons[t.id] ?? ""}
                  onChange={(e) => setRejectionReasons((r) => ({ ...r, [t.id]: e.target.value }))}
                />
                <Button variant="danger" loading={busyId === `${t.id}:reject`} disabled={translationRowBusy(t.id)} onClick={() => void decideTranslation(t.id, "reject")}>
                  Reject translation
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as "hi" | "te" | "ur")}
          style={{ padding: "var(--space-xs)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text)" }}
        >
          <option value="hi">Hindi</option>
          <option value="te">Telugu</option>
          <option value="ur">Urdu</option>
        </select>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Translated text"
          style={{ padding: "var(--space-sm)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", color: "var(--color-text)", font: "inherit" }}
        />
        <Button loading={busyId === "new"} disabled={busyId === "new" || !body} onClick={() => void proposeTranslation()}>
          Propose translation
        </Button>
      </div>
    </div>
  );
}

interface ContentDetail {
  id: string;
  kind: string;
  ingredient: { id: string; name: string } | null;
  product: { id: string; genericName: string; brand: { name: string } | null } | null;
  currentVersion: VersionDetail | null;
  versions: VersionDetail[];
}

function subjectName(content: ContentDetail): string {
  if (content.ingredient) return content.ingredient.name;
  if (content.product) return `${content.product.brand?.name ?? content.product.genericName} (combination)`;
  return "Unknown";
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
    setBusyVersionId(`${versionId}:${decision}`);
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

  /** Either decision for this version is in flight — disables both buttons; `loading` still keys to the one actually clicked. */
  function versionRowBusy(versionId: string): boolean {
    return busyVersionId === `${versionId}:approve` || busyVersionId === `${versionId}:reject`;
  }

  if (!content) {
    return (
      <AdminShell>
        <PillSpinner label="Loading…" />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <Button variant="ghost" onClick={() => router.replace("/content")}>← Back to content</Button>
      <h1 style={{ fontSize: "var(--font-title)" }}>
        {subjectName(content)} — {KIND_LABELS[content.kind] ?? content.kind}
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
          <span style={{ color: "var(--color-text-muted)" }}>Nothing approved yet — patients see the standard "not available" fallback for this {content.ingredient ? "ingredient" : "combination product"}.</span>
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
              <Button loading={busyVersionId === `${v.id}:approve`} disabled={versionRowBusy(v.id)} onClick={() => void decide(v.id, "approve")}>
                Approve — show to patients
              </Button>
              <TextInput
                label="Rejection reason (optional)"
                value={rejectionReasons[v.id] ?? ""}
                onChange={(e) => setRejectionReasons((r) => ({ ...r, [v.id]: e.target.value }))}
              />
              <Button variant="danger" loading={busyVersionId === `${v.id}:reject`} disabled={versionRowBusy(v.id)} onClick={() => void decide(v.id, "reject")}>
                Reject
              </Button>
            </div>
          ) : null}

          {v.reviewStatus === "approved" ? <TranslationsPanel version={v} onChanged={load} /> : null}
        </Card>
      ))}
    </AdminShell>
  );
}
