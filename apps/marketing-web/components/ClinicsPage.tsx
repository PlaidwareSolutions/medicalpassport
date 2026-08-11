import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { Chip, ChipRow } from "./Chip";
import { PhoneFrame, ProductMedia } from "./ProductMedia";
import { PlaceholderMedia } from "./PlaceholderMedia";
import { LeadForm } from "./LeadForm";
import { videoAsset } from "../lib/published-media";

/**
 * /for-clinics/ — the professional narrative C1–C7 (Stage 7 CLEARED). English
 * only in V1 (OD-LP-4). Uses the real Stage-7 share media for C3. Copy is
 * non-outcome only (no efficiency/error statistics); revocation wording is
 * precise (stops future link access, cannot recall a downloaded copy).
 */
export function ClinicsPage({ locale }: { locale: MarketingLocale }) {
  const shareMedia = videoAsset("r7-share-doctor");
  return (
    <>
      {/* C1 — hero */}
      <section className="mkt-section" aria-labelledby="c1-title" style={{ paddingBlockStart: "40px" }}>
        <div className="mkt-container mkt-hero-grid">
          <div style={{ maxWidth: "36ch" }}>
            <h1 id="c1-title">{t(locale, "clinics.c1_h1")}</h1>
            <p className="mkt-muted" style={{ marginTop: "14px" }}>
              {t(locale, "clinics.c1_body")}
            </p>
            <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
              <a
                href="#c7-lead"
                style={{
                  display: "inline-block",
                  background: "var(--mkt-primary)",
                  color: "#fff",
                  borderRadius: "var(--radius)",
                  minHeight: "var(--size-touch)",
                  padding: "13px 22px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                {t(locale, "clinics.c1_cta")}
              </a>
              <a href="/" style={{ fontWeight: 600 }}>
                {t(locale, "clinics.c1_secondary")} →
              </a>
            </div>
          </div>
          <PhoneFrame>
            {shareMedia ? (
              <ProductMedia sources={shareMedia.sources} poster={shareMedia.poster} label={shareMedia.transcript ?? t(locale, "clinics.c3_media_label")} eager />
            ) : (
              <PlaceholderMedia locale={locale} label={t(locale, "clinics.c3_media_label")} />
            )}
          </PhoneFrame>
        </div>
      </section>

      {/* C2 — problem (no statistics) */}
      <section className="mkt-section" aria-labelledby="c2-title" style={{ borderTop: "1px solid var(--mkt-hairline)" }}>
        <div className="mkt-container-text">
          <h2 id="c2-title">{t(locale, "clinics.c2_h2")}</h2>
          <p style={{ marginTop: "14px" }}>{t(locale, "clinics.c2_body")}</p>
        </div>
      </section>

      {/* C3 — what the professional sees (real share media) */}
      <section className="mkt-section" aria-labelledby="c3-title" style={{ background: "var(--mkt-surface)" }}>
        <div className="mkt-container mkt-p2 mkt-media-left">
          <div className="mkt-p2-media">
            <PhoneFrame>
              {shareMedia ? (
                <ProductMedia sources={shareMedia.sources} poster={shareMedia.poster} label={shareMedia.transcript ?? t(locale, "clinics.c3_media_label")} />
              ) : (
                <PlaceholderMedia locale={locale} label={t(locale, "clinics.c3_media_label")} />
              )}
            </PhoneFrame>
          </div>
          <div className="mkt-p2-copy">
            <h2 id="c3-title">{t(locale, "clinics.c3_h2")}</h2>
            <p style={{ marginTop: "14px", maxWidth: "58ch" }}>{t(locale, "clinics.c3_body")}</p>
          </div>
        </div>
      </section>

      {/* C4 — simple access (two real steps; no "no workflow change") */}
      <section className="mkt-section" aria-labelledby="c4-title" style={{ textAlign: "center" }}>
        <div className="mkt-container-text">
          <h2 id="c4-title">{t(locale, "clinics.c4_h2")}</h2>
          <ol style={{ marginTop: "20px", textAlign: "start", maxWidth: "42ch", marginInline: "auto", display: "grid", gap: "12px", paddingInlineStart: "1.2em" }}>
            <li>{t(locale, "clinics.c4_step1")}</li>
            <li>{t(locale, "clinics.c4_step2")}</li>
          </ol>
        </div>
      </section>

      {/* C5 — patient-controlled access */}
      <section className="mkt-section" aria-labelledby="c5-title" style={{ background: "var(--mkt-surface)" }}>
        <div className="mkt-container-text">
          <h2 id="c5-title">{t(locale, "clinics.c5_h2")}</h2>
          <p style={{ marginTop: "14px" }}>{t(locale, "clinics.c5_body")}</p>
          <div style={{ marginTop: "18px" }}>
            <ChipRow>
              <Chip>{t(locale, "clinics.c5_chip_patient")}</Chip>
              <Chip>{t(locale, "clinics.c5_chip_expires")}</Chip>
              <Chip>{t(locale, "clinics.c5_chip_revocable")}</Chip>
              <Chip>{t(locale, "clinics.c5_chip_logged")}</Chip>
            </ChipRow>
          </div>
        </div>
      </section>

      {/* C6 — professional value (non-outcome tiles) */}
      <section className="mkt-section" aria-labelledby="c6-title">
        <div className="mkt-container">
          <h2 id="c6-title">{t(locale, "clinics.c6_h2")}</h2>
          <div className="mkt-trust" style={{ gridTemplateColumns: "1fr" }}>
            <div className="mkt-tcard" style={{ display: "grid", gap: "10px" }}>
              {(["clinics.c6_tile1", "clinics.c6_tile2", "clinics.c6_tile3", "clinics.c6_tile4"] as const).map((k) => (
                <p key={k} style={{ fontWeight: 600 }}>
                  {t(locale, k)}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* C7 — lead form */}
      <section id="c7-lead" className="mkt-section" aria-labelledby="c7-title" style={{ background: "var(--mkt-surface)" }}>
        <div className="mkt-container mkt-p2">
          <div className="mkt-p2-copy">
            <h2 id="c7-title">{t(locale, "clinics.c7_h2")}</h2>
            <p style={{ marginTop: "14px", maxWidth: "48ch" }}>{t(locale, "clinics.c7_body")}</p>
          </div>
          <div className="mkt-p2-media">
            <LeadForm locale={locale} />
          </div>
        </div>
      </section>
    </>
  );
}
