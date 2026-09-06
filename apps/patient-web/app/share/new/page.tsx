"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import type { VisitSummaryDto } from "@medpass/api-client";
import { SHARE_AUDIENCES, SHARE_EXPIRY_PRESETS, type ShareAudience, type ShareExpiryPreset } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { ScopeNotice } from "../../../components/ScopeGate";
import { VisitSummarySections } from "../../../components/VisitSummarySections";
import { isStepUpRequired } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { useProfileAccess } from "../../../lib/scopes";
import {
  SHARE_SECTIONS,
  createShare,
  shareUrl,
  shareVisitSummaryViaWhatsApp,
  useVisitSummary,
  type ShareSection,
} from "../../../lib/sharing";

/**
 * Create a share (docs_v2/06 P7-3): WHAT, WHO, HOW LONG — in that order,
 * because that is the order the patient decides in.
 *
 * Two things here are safety features, not features:
 *
 * 1. Every section is sent explicitly, true or false (see `fullSectionMap`).
 *    The server merges what it receives over a default in which nearly
 *    everything is on, so an unticked box that is simply omitted would be
 *    shared anyway.
 * 2. Nothing is created until the patient has been shown what the recipient
 *    will see. A share link cannot be un-seen once sent, so the preview is
 *    the last honest moment.
 *
 * Documents are off by default and stay that way unless chosen by name:
 * choosing them lets whoever holds the link open every page of every
 * document, which is a different order of exposure from a medicine list.
 */

/** Matches the server's default share — everything except the document pages. */
function defaultSections(): Record<ShareSection, boolean> {
  return Object.fromEntries(SHARE_SECTIONS.map((s) => [s, s !== "documents"])) as Record<ShareSection, boolean>;
}

export default function CreateSharePage() {
  const { t } = useI18n();
  const access = useProfileAccess();
  const [sections, setSections] = useState<Record<ShareSection, boolean>>(defaultSections);
  const [fullPassport, setFullPassport] = useState(false);
  const [audience, setAudience] = useState<ShareAudience | undefined>();
  const [expiresIn, setExpiresIn] = useState<ShareExpiryPreset>("24h");
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ url: string } | undefined>();
  const [copied, setCopied] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [whatsAppError, setWhatsAppError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Full passport is the server's own "everything" — reflect that in the
  // boxes rather than leaving them showing a narrower selection than the
  // link will actually carry.
  const effective: Record<ShareSection, boolean> = fullPassport
    ? (Object.fromEntries(SHARE_SECTIONS.map((s) => [s, true])) as Record<ShareSection, boolean>)
    : sections;
  const chosenCount = SHARE_SECTIONS.filter((s) => effective[s]).length;

  useEffect(() => {
    if (result && canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, result.url, { width: 220, margin: 1 });
    }
  }, [result]);

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await createShare({
        sections,
        fullPassport,
        audience: audience ?? "unspecified",
        expiresIn,
        kind: "qr",
      });
      setResult({ url: shareUrl(res.token) });
    } catch (err) {
      // Share creation is step-up guarded (ADR-V2-012): a cancelled
      // "Confirm it's you" sheet surfaces as the original 403 — say that
      // nothing was created rather than "something went wrong".
      setError(isStepUpRequired(err) ? t("stepup.not_confirmed") : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareViaWhatsApp() {
    setWhatsAppBusy(true);
    setWhatsAppError(false);
    try {
      await shareVisitSummaryViaWhatsApp(effective);
    } catch {
      setWhatsAppError(true);
    } finally {
      setWhatsAppBusy(false);
    }
  }

  // Sharing is a permission of its own: a caregiver trusted to read the
  // record is not thereby trusted to hand it to a stranger.
  if (access.ready && !access.can("share_records")) {
    return (
      <AppShell>
        <PageHeader title={t("share.new_title")} />
        <ScopeNotice action="share_records" />
      </AppShell>
    );
  }

  if (result) {
    return (
      <AppShell>
        <PageHeader title={t("share.ready_title")} />
        <Card>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <canvas ref={canvasRef} role="img" aria-label={t("share.qr_code_alt")} />
          </div>
          <div style={{ wordBreak: "break-all", fontSize: "var(--font-small)", color: "var(--color-text-muted)", textAlign: "center" }}>
            {result.url}
          </div>
          <Button fullWidth onClick={() => void copy()}>
            {copied ? t("share.copied") : t("share.copy_link")}
          </Button>
        </Card>
        <Banner tone="info">{t("share.revocable_note")}</Banner>
        <Link href="/share">
          <Button variant="secondary" fullWidth>
            {t("share.view_all")}
          </Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("share.new_title")} readAloud={[{ audio: "screen.share_new" }]} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {/* WHAT */}
      <SectionTitle>{t("share.what_label")}</SectionTitle>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-sm)",
          minHeight: "var(--size-touch)",
          padding: "var(--space-sm)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          data-testid="share-section-full_passport"
          checked={fullPassport}
          onChange={(e) => setFullPassport(e.target.checked)}
          style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2 }}
        />
        <span>
          <span>{t("share.section.full_passport")}</span>
          <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("share.section_note.full_passport")}
          </span>
        </span>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
        {SHARE_SECTIONS.map((key) => (
          <label
            key={key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-sm)",
              minHeight: "var(--size-touch)",
              padding: "var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              cursor: fullPassport ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              data-testid={`share-section-${key}`}
              checked={effective[key]}
              disabled={fullPassport}
              onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.checked }))}
              style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2 }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ overflowWrap: "anywhere" }}>{t(`share.section.${key}` as never)}</span>
              {key === "documents" ? (
                <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("share.section_note.documents")}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      {/* WHO — informational and logged, never an authorization: anyone
          holding the link can open it whatever is picked here, so the help
          text below says exactly that rather than implying a lock. */}
      <SectionTitle>{t("share.who_label")}</SectionTitle>
      <ChoiceGrid
        label={t("share.who_label")}
        columns={2}
        choices={SHARE_AUDIENCES.map((a) => ({ value: a, label: t(`share.audience.${a}` as never) }))}
        value={audience}
        onChange={setAudience}
      />
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("share.who_help")}</span>

      {/* HOW LONG */}
      <SectionTitle>{t("share.expiry_label")}</SectionTitle>
      <div role="group" aria-label={t("share.expiry_label")} style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {SHARE_EXPIRY_PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={expiresIn === preset ? "primary" : "secondary"}
            aria-pressed={expiresIn === preset}
            data-testid={`share-expiry-${preset}`}
            onClick={() => setExpiresIn(preset)}
            style={{ flex: "1 1 auto" }}
          >
            {t(`share.expiry_preset.${preset}` as never)}
          </Button>
        ))}
      </div>

      {/* PREVIEW — before anything exists. */}
      <div style={{ marginTop: "var(--space-md)" }}>
        <Button variant="secondary" fullWidth aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? t("share.preview_hide") : t("share.preview_show")}
        </Button>
      </div>
      {showPreview ? <SharePreview sections={effective} /> : null}

      <div style={{ height: "var(--space-md)" }} />
      <Button fullWidth loading={busy} disabled={busy || chosenCount === 0} onClick={() => void create()}>
        {t("share.create")}
      </Button>
      {chosenCount === 0 ? (
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("share.nothing_chosen")}</span>
      ) : null}

      <div style={{ height: "var(--space-md)" }} />
      {whatsAppError ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      <Button variant="secondary" fullWidth disabled={whatsAppBusy} onClick={() => void shareViaWhatsApp()}>
        {t("share.whatsapp_button")}
      </Button>
    </AppShell>
  );
}

/** The V2 sections the summary carries but the shared renderer has no block for yet. */
type ExtendedSummary = VisitSummaryDto & {
  measurements?: Array<{ label: string; count: number }>;
  documents?: Array<{ id: string; pageCount: number }>;
  encounters?: Array<{ startedAt: string }>;
};

/**
 * What the recipient will see, built from the patient's own summary and cut
 * down to the chosen sections — the same data the share is made from, so
 * the preview cannot drift from the thing it previews.
 *
 * The checklist above the content is the part that matters most: it names
 * every section, including the ones NOT shared, because "what did I leave
 * out" is exactly as important as "what did I include" and content alone
 * cannot say it (an empty section and an unshared one look identical).
 */
function SharePreview({ sections }: { sections: Record<ShareSection, boolean> }) {
  const { t } = useI18n();
  const { data, error } = useVisitSummary();
  const summary = data as ExtendedSummary | undefined;

  const counts: Partial<Record<ShareSection, number>> = summary
    ? {
        medications: summary.currentMedications?.length ?? 0,
        allergies: summary.allergies?.length ?? 0,
        conditions: summary.conditions?.length ?? 0,
        recentChanges: summary.recentChanges?.length ?? 0,
        concerns: summary.unresolvedConcerns?.length ?? 0,
        reports: summary.reports?.length ?? 0,
        prescriptions: summary.prescriptions?.length ?? 0,
        checkups: summary.checkups?.length ?? 0,
        glucoseReadings: summary.glucoseReadings?.readingCount ?? 0,
        bloodPressureReadings: summary.bloodPressureReadings?.readingCount ?? 0,
        weightReadings: summary.weightReadings?.readingCount ?? 0,
        measurements: summary.measurements?.length ?? 0,
        documents: summary.documents?.length ?? 0,
        encounters: summary.encounters?.length ?? 0,
      }
    : {};

  // Only the chosen sections reach the renderer — an absent field renders
  // nothing, which is exactly how the recipient's own view behaves.
  const filtered: VisitSummaryDto | undefined = summary
    ? {
        profile: summary.profile,
        generatedAt: summary.generatedAt,
        ...(sections.medications ? { currentMedications: summary.currentMedications } : {}),
        ...(sections.allergies ? { allergies: summary.allergies } : {}),
        ...(sections.conditions ? { conditions: summary.conditions } : {}),
        ...(sections.recentChanges ? { recentChanges: summary.recentChanges } : {}),
        ...(sections.concerns ? { unresolvedConcerns: summary.unresolvedConcerns } : {}),
        ...(sections.glucoseReadings ? { glucoseReadings: summary.glucoseReadings } : {}),
        ...(sections.bloodPressureReadings ? { bloodPressureReadings: summary.bloodPressureReadings } : {}),
        ...(sections.weightReadings ? { weightReadings: summary.weightReadings } : {}),
        ...(sections.checkups ? { checkups: summary.checkups } : {}),
        ...(sections.prescriptions ? { prescriptions: summary.prescriptions } : {}),
        ...(sections.reports ? { reports: summary.reports } : {}),
      }
    : undefined;

  return (
    <Card tone="info" data-testid="share-preview">
      <strong>{t("share.preview_title")}</strong>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("share.preview_intro")}</span>

      {error && !summary ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {!summary && !error ? <PillSpinner label={t("common.loading")} /> : null}

      <ul style={{ margin: 0, paddingInlineStart: "var(--space-md)" }}>
        {SHARE_SECTIONS.map((key) => (
          <li key={key} data-testid={`preview-section-${key}`} data-shared={sections[key] ? "yes" : "no"}>
            <span style={{ overflowWrap: "anywhere" }}>{t(`share.section.${key}` as never)}</span>{" "}
            {sections[key] ? (
              <span>{t("share.preview_included", { count: counts[key] ?? 0 })}</span>
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>{t("share.preview_not_shared")}</span>
            )}
          </li>
        ))}
      </ul>

      {sections.documents ? <Banner tone="warning">{t("share.preview_documents_warning")}</Banner> : null}

      {filtered ? (
        <div>
          <SectionTitle>{t("share.preview_content_title")}</SectionTitle>
          <VisitSummarySections data={filtered} />
        </div>
      ) : null}
    </Card>
  );
}
