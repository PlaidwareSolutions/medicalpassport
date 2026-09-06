"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { isStepUpRequired } from "../../../lib/api";
import {
  ONBOARDING_EXPIRIES,
  PROVIDER_LINK_SECTIONS,
  createOnboardingToken,
  sectionLabelKey,
  type OnboardingExpiry,
  type OnboardingTokenDto,
  type ProviderLinkSection,
} from "../../../lib/connections";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../../../lib/patient-time";

/** The sections a clinic visit actually needs; everything else is opt-in (minimal necessary, docs_v2/11). */
const DEFAULT_SECTIONS: ProviderLinkSection[] = ["medications", "allergies", "conditions", "recentChanges", "concerns"];

const ACCESS_DAYS = [7, 30, 90] as const;

/**
 * "Show my code at a clinic" (docs_v2/06 P11-3). The patient mints a
 * short-lived token, the clinic scans it, and a section-scoped link is
 * created — so the choice of what to share is made *before* the code
 * exists, never after someone has already scanned it. The screen states
 * both halves of the bargain in one sentence: what they will see, and for
 * how long, with the reminder that it can be ended at any time.
 *
 * Minting is step-up guarded (ADR-V2-012) — it hands a clinic the same
 * access a share link would.
 */
export default function ShowClinicCodePage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const [sections, setSections] = useState<ProviderLinkSection[]>(DEFAULT_SECTIONS);
  const [expiresIn, setExpiresIn] = useState<OnboardingExpiry>("15m");
  const [accessDays, setAccessDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [minted, setMinted] = useState<OnboardingTokenDto | undefined>();
  // The canvas is the preferred rendering; if it can't be drawn the code is
  // still usable — it is read out or typed in instead (see below).
  const [qrFailed, setQrFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!minted || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, minted.token, { width: 240, margin: 1 }).catch(() => setQrFailed(true));
  }, [minted]);

  function toggle(section: ProviderLinkSection) {
    setSections((prev) => (prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]));
  }

  async function mint() {
    setBusy(true);
    setError(undefined);
    try {
      setMinted(await createOnboardingToken({ sections, expiresIn, accessDays }));
    } catch (err) {
      setError(isStepUpRequired(err) ? t("stepup.not_confirmed") : err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const sectionNames = sections.map((s) => t(sectionLabelKey(s))).join(", ");

  if (minted) {
    return (
      <AppShell>
        <PageHeader title={t("connections.code_ready_title")} />
        <Card data-testid="onboarding-code">
          <div style={{ display: "flex", justifyContent: "center" }}>
            {/* Hidden rather than unmounted when drawing failed, so the ref
                the effect draws into always exists on the first paint. */}
            <canvas ref={canvasRef} role="img" aria-label={t("connections.qr_alt")} hidden={qrFailed} />
          </div>
          {qrFailed ? <Banner tone="warning">{t("connections.qr_unavailable")}</Banner> : null}
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("connections.code_readable_label")}</span>
          {/* Always shown, not only on failure: a scanner that won't focus
              is common, and reading the code out is the honest fallback. */}
          <code
            data-testid="onboarding-code-text"
            style={{ fontSize: "var(--font-large)", letterSpacing: "0.08em", wordBreak: "break-all", fontWeight: 600, lineHeight: 1.6 }}
          >
            {minted.token}
          </code>
          <Banner tone="info">
            {t("connections.code_explains", {
              sections: sectionNames,
              expiry: t(`connections.expiry.${expiresIn}` as never),
              days: minted.accessDays,
            })}
          </Banner>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("connections.code_expires_at", { time: formatPatientDateTime(minted.expiresAt, timezone) })}
          </span>
        </Card>

        <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Button variant="secondary" fullWidth onClick={() => { setMinted(undefined); setQrFailed(false); }}>
            {t("connections.code_new")}
          </Button>
          <Link href="/connections">
            <Button variant="ghost" fullWidth>
              {t("connections.back_to_list")}
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("connections.code_title")} readAloud={[{ audio: "screen.connections_code" }]} />
      <p style={{ margin: "0 0 var(--space-md)" }}>{t("connections.code_intro")}</p>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <SectionTitle>{t("connections.sections_label")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {PROVIDER_LINK_SECTIONS.map((section) => (
          <label
            key={section}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              minHeight: "var(--size-touch)",
              padding: "var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={sections.includes(section)} onChange={() => toggle(section)} style={{ width: 24, height: 24 }} />
            {t(sectionLabelKey(section))}
          </label>
        ))}
      </div>

      <SectionTitle>{t("connections.expiry_label")}</SectionTitle>
      <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("connections.expiry_help")}</p>
      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {ONBOARDING_EXPIRIES.map((option) => (
          <Button
            key={option}
            variant={expiresIn === option ? "primary" : "secondary"}
            aria-pressed={expiresIn === option}
            onClick={() => setExpiresIn(option)}
            style={{ flex: "1 1 auto" }}
          >
            {t(`connections.expiry.${option}` as never)}
          </Button>
        ))}
      </div>

      <SectionTitle>{t("connections.access_days_label")}</SectionTitle>
      <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("connections.access_days_help")}</p>
      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {ACCESS_DAYS.map((days) => (
          <Button
            key={days}
            variant={accessDays === days ? "primary" : "secondary"}
            aria-pressed={accessDays === days}
            onClick={() => setAccessDays(days)}
            style={{ flex: "1 1 auto" }}
          >
            {t("connections.access_days_option", { n: days })}
          </Button>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-md)" }}>
        {sections.length > 0 ? (
          <Card tone="info">
            <Chip>{t("connections.summary_label")}</Chip>
            <span data-testid="code-explains">
              {t("connections.code_explains", { sections: sectionNames, expiry: t(`connections.expiry.${expiresIn}` as never), days: accessDays })}
            </span>
          </Card>
        ) : (
          <Banner tone="warning">{t("connections.need_a_section")}</Banner>
        )}
      </div>

      <div style={{ marginTop: "var(--space-md)" }}>
        <Button fullWidth loading={busy} disabled={busy || sections.length === 0} onClick={() => void mint()} data-testid="mint-code">
          {t("connections.create_code")}
        </Button>
      </div>
    </AppShell>
  );
}
