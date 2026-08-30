import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { FAQ_ITEMS } from "../lib/faq-items";
import { Chip, ChipRow } from "./Chip";
import { CtaLink } from "./CtaLink";
import { HERO_CTA_SENTINEL_ID } from "./SiteHeader";
import { PlaceholderMedia } from "./PlaceholderMedia";
import { PhoneFrame, ProductMedia } from "./ProductMedia";
import { AudioSample } from "./AudioSample";
import { CommercialFilm } from "./CommercialFilm";
import { QrCard } from "./QrCard";
import { LanguageCycler } from "./LanguageCycler";
import { TiltCard } from "./TiltCard";
import { IllustrationScatter, IllustrationTwoNames, IllustrationTwoCities } from "./Illustrations";
import { videoAsset, AUDIO_SAMPLE_URL } from "../lib/published-media";

/**
 * Published real-product media when it exists (Session 9B), placeholder
 * otherwise — the placeholder infrastructure stays for genuinely deferred
 * media (future sharing beat, locale variants). The published transcript
 * becomes the video's accessible label; the section copy remains the
 * narrative carrier (no video-only information).
 */
function SectionMedia({
  locale,
  assetId,
  labelKey,
  eager,
}: {
  locale: MarketingLocale;
  assetId: string;
  labelKey: Parameters<typeof t>[1];
  eager?: boolean;
}) {
  const asset = videoAsset(assetId);
  if (!asset) return <PlaceholderMedia locale={locale} label={t(locale, labelKey)} />;
  return (
    <PhoneFrame>
      <ProductMedia sources={asset.sources} poster={asset.poster} label={asset.transcript ?? t(locale, labelKey)} eager={eager} />
    </PhoneFrame>
  );
}

/**
 * Homepage sections S1–S14 (docs/landing-page/04-content-spec.md), all
 * server components — client JS on this page is limited to the sticky
 * header. Gated sections/lines are NOT emitted (no display:none hiding):
 *  - S9 / S12: professional unit, lib/release-flags.ts (OD-LP-10 addendum)
 *  - clinical/business gated sentences: lib/content-gates.ts
 * GATE() comments mark every enablement point.
 */

// ── S1 ──────────────────────────────────────────────────────────────────────
export function Hero({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-section mkt-hero-section" aria-labelledby="hero-title" style={{ paddingBlockStart: "40px" }}>
      <div className="mkt-hero-glow" aria-hidden="true" />
      <div className="mkt-container mkt-hero-grid" style={{ position: "relative" }}>
        <div style={{ maxWidth: "36ch" }}>
          <h1 id="hero-title">{t(locale, "hero.h1")}</h1>
          <p className="mkt-muted" style={{ marginTop: "12px", maxWidth: "34ch" }}>
            {t(locale, "hero.sub")}
          </p>
          <div style={{ marginTop: "20px" }}>
            <ChipRow>
              <Chip>{t(locale, "hero.chip_free")}</Chip>
              <Chip>{t(locale, "hero.chip_no_install")}</Chip>
              <Chip>
                <LanguageCycler fullText={t(locale, "hero.chip_languages")} />
              </Chip>
            </ChipRow>
          </div>
          <div id={HERO_CTA_SENTINEL_ID} style={{ marginTop: "24px" }}>
            <CtaLink locale={locale} wide />
          </div>
          <p style={{ marginTop: "16px" }}>
            <a href="#s2-problem" style={{ fontWeight: 600, display: "inline-block", paddingBlock: "4px" }}>
              {t(locale, "hero.secondary")} ↓
            </a>
          </p>
          <div style={{ marginTop: "24px" }}>
            <QrCard locale={locale} />
          </div>
        </div>
        <SectionMedia locale={locale} assetId="r1-hero-sources" labelKey="hero.media_label" eager />
      </div>
    </section>
  );
}

// ── S2 ──────────────────────────────────────────────────────────────────────
export function Problem({ locale }: { locale: MarketingLocale }) {
  const stories = [
    { title: "problem.a_title", body: "problem.a_body", Art: IllustrationScatter },
    { title: "problem.b_title", body: "problem.b_body", Art: IllustrationTwoNames },
    { title: "problem.c_title", body: "problem.c_body", Art: IllustrationTwoCities },
  ] as const;
  return (
    <section id="s2-problem" className="mkt-section" aria-labelledby="problem-title" style={{ borderTop: "1px solid var(--mkt-hairline)" }}>
      <div className="mkt-container">
        <h2 id="problem-title">{t(locale, "problem.h2")}</h2>
        <div className="mkt-stories">
          {stories.map(({ title, body, Art }) => (
            <article key={title} className="mkt-story mkt-reveal">
              <Art />
              <div className="mkt-story-body">
                <h3>{t(locale, title)}</h3>
                <p style={{ fontSize: "0.9375rem", lineHeight: 1.55 }}>
                  {t(locale, body)}
                  {/* GATE(CLINICAL): Story B product tie-in sentence — 04 §S2, MKT-030 */}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="mkt-container-text" style={{ marginTop: "56px", textAlign: "center" }}>
        <p style={{ fontSize: "1.375rem", fontWeight: 700, lineHeight: 1.35, textWrap: "balance" }}>
          {t(locale, "problem.thesis")}
        </p>
        <p style={{ marginTop: "16px", fontSize: "1.25rem", fontWeight: 800, color: "var(--mkt-primary)" }}>
          {t(locale, "problem.reveal")}
        </p>
      </div>
    </section>
  );
}

// ── S3 ──────────────────────────────────────────────────────────────────────
export function Reveal({ locale }: { locale: MarketingLocale }) {
  const fields = [
    ["reveal.f_name", "reveal.f_name_v"],
    ["reveal.f_ingredient", "reveal.f_ingredient_v"],
    ["reveal.f_schedule", "reveal.f_schedule_v"],
    ["reveal.f_doctor", "reveal.f_doctor_v"],
    ["reveal.f_reason", "reveal.f_reason_v"],
    ["reveal.f_status", "reveal.f_status_v"],
  ] as const;
  return (
    <section className="mkt-section" aria-labelledby="reveal-title" style={{ background: "var(--mkt-surface)" }}>
      <div className="mkt-container mkt-p2 mkt-media-left">
        <div className="mkt-p2-media mkt-reveal">
          <TiltCard>
          <div className="mkt-passport-card">
            <dl>
              {fields.map(([k, v]) => (
                <div key={k}>
                  <dt>{t(locale, k)}</dt>
                  <dd>{t(locale, v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mkt-muted" style={{ fontSize: "0.75rem", marginTop: "14px" }}>
              {t(locale, "reveal.card_caption")}
            </p>
          </div>
          </TiltCard>
        </div>
        <div className="mkt-p2-copy">
          <h2 id="reveal-title">{t(locale, "reveal.h2")}</h2>
          <p style={{ marginTop: "14px", maxWidth: "58ch" }}>{t(locale, "reveal.body")}</p>
          <div style={{ marginTop: "22px" }}>
            <CtaLink locale={locale} />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Owner-directed brand film (2026-08-30), placed between the Reveal and Know
 * sections. Renders ONLY when the commercial is published — no placeholder,
 * the page seams S3 → S4 exactly as before when the asset is absent. The
 * film has a soundtrack; per the owner's 2026-08-31 direction it autoplays
 * on scroll (unmuted where the browser allows, muted + "tap for sound"
 * otherwise; reduced-motion/Save-Data keep click-to-play) — see
 * CommercialFilm for the ladder.
 */
export function Film({ locale }: { locale: MarketingLocale }) {
  const asset = videoAsset("r8-commercial");
  if (!asset) return null;
  return (
    <section className="mkt-section" aria-labelledby="film-title" style={{ background: "var(--mkt-surface)" }}>
      <div className="mkt-container" style={{ textAlign: "center" }}>
        <h2 id="film-title">{t(locale, "film.h2")}</h2>
        <p className="mkt-muted" style={{ marginTop: "10px", marginBottom: "26px", maxWidth: "48ch", marginInline: "auto" }}>
          {t(locale, "film.lead")}
        </p>
        <CommercialFilm
          sources={asset.sources}
          poster={asset.poster}
          label={asset.transcript ?? t(locale, "film.h2")}
          playLabel={t(locale, "film.play")}
          unmuteLabel={t(locale, "film.unmute")}
        />
      </div>
    </section>
  );
}

// ── S4 / S5 / S7 / S8 share the P2 row shape ───────────────────────────────
function MediaRow({
  locale,
  id,
  assetId,
  mediaLeft,
  titleKey,
  bodyKey,
  mediaLabelKey,
  chips,
  extra,
  cta,
}: {
  locale: MarketingLocale;
  id: string;
  assetId: string;
  mediaLeft?: boolean;
  titleKey: Parameters<typeof t>[1];
  bodyKey: Parameters<typeof t>[1];
  mediaLabelKey: Parameters<typeof t>[1];
  chips?: Parameters<typeof t>[1][];
  extra?: React.ReactNode;
  cta?: React.ReactNode;
}) {
  return (
    <section className="mkt-section" aria-labelledby={`${id}-title`}>
      <div className={`mkt-container mkt-p2${mediaLeft ? " mkt-media-left" : ""}`}>
        <div className="mkt-p2-copy">
          <h2 id={`${id}-title`}>{t(locale, titleKey)}</h2>
          <p style={{ marginTop: "14px", maxWidth: "58ch" }}>{t(locale, bodyKey)}</p>
          {extra}
          {chips ? (
            <div style={{ marginTop: "18px" }}>
              <ChipRow>
                {chips.map((c) => (
                  <Chip key={c}>{t(locale, c)}</Chip>
                ))}
              </ChipRow>
            </div>
          ) : null}
          {cta}
        </div>
        <div className="mkt-p2-media mkt-reveal">
          <SectionMedia locale={locale} assetId={assetId} labelKey={mediaLabelKey} />
        </div>
      </div>
    </section>
  );
}

export function Know({ locale }: { locale: MarketingLocale }) {
  // GATE(CLINICAL): education sentence ("plain language, where available") — 04 §S4, MKT-014
  return (
    <MediaRow
      locale={locale}
      id="s4-know"
      assetId="r2-add-medicine"
      titleKey="know.h2"
      bodyKey="know.body"
      mediaLabelKey="know.media_label"
      chips={["know.chip_photo", "know.chip_search", "know.chip_manual"]}
    />
  );
}

export function Remember({ locale }: { locale: MarketingLocale }) {
  // GATE(CLINICAL): caregiver-escalation sentence — 04 §S5, MKT-022
  return (
    <MediaRow
      locale={locale}
      id="s5-remember"
      assetId="r3-timeline"
      mediaLeft
      titleKey="remember.h2"
      bodyKey="remember.body"
      mediaLabelKey="remember.media_label"
      chips={["remember.chip_timeline", "remember.chip_reminders", "remember.chip_refills"]}
    />
  );
}

// ── S6 ──────────────────────────────────────────────────────────────────────
export function Accessible({ locale }: { locale: MarketingLocale }) {
  const langs = [
    { key: "access.lang_en", lang: "en", dir: "ltr" },
    { key: "access.lang_hi", lang: "hi", dir: "ltr" },
    { key: "access.lang_te", lang: "te", dir: "ltr" },
    { key: "access.lang_ur", lang: "ur", dir: "rtl" },
  ] as const;
  return (
    <section className="mkt-section" aria-labelledby="s6-title" style={{ background: "var(--mkt-surface)" }}>
      <div className="mkt-container">
        <h2 id="s6-title" style={{ maxWidth: "28ch" }}>
          {t(locale, "access.h2")}
        </h2>
        <p style={{ marginTop: "8px", fontWeight: 700, color: "var(--mkt-primary)", fontSize: "1.25rem" }}>
          {t(locale, "access.sub")}
        </p>
        <p style={{ marginTop: "14px", maxWidth: "65ch" }}>{t(locale, "access.body")}</p>
        <div className="mkt-langs mkt-reveal" style={{ marginTop: "28px" }} aria-label={t(locale, "access.media_label")}>
          {langs.map((l) => (
            <div key={l.key} className="mkt-lang-card" lang={l.lang} dir={l.dir}>
              <b>{t(locale, l.key)}</b>
              <span className="mkt-lang-listen">
                <span aria-hidden="true">▶</span> {t(locale, "access.listen")}
              </span>
            </div>
          ))}
        </div>
        <div className="mkt-p2 mkt-media-left" style={{ marginTop: "40px" }}>
          <div className="mkt-p2-media mkt-reveal">
            <SectionMedia locale={locale} assetId="r4-listen" labelKey="access.video_label" />
          </div>
          <div className="mkt-p2-copy">
            {AUDIO_SAMPLE_URL ? (
              <>
                <AudioSample
                  src={AUDIO_SAMPLE_URL}
                  playLabel={t(locale, "access.audio_cta")}
                  stopLabel={t(locale, "access.audio_stop")}
                  errorLabel={t(locale, "access.audio_error")}
                />
                <p className="mkt-muted" style={{ marginTop: "12px", fontSize: "0.875rem", maxWidth: "42ch" }}>
                  {t(locale, "access.audio_note")}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Offline({ locale }: { locale: MarketingLocale }) {
  return (
    <MediaRow
      locale={locale}
      id="s7-offline"
      assetId="r5-offline"
      titleKey="offline.h2"
      bodyKey="offline.body"
      mediaLabelKey="offline.media_label"
      extra={
        <p style={{ marginTop: "12px", fontWeight: 700 }}>{t(locale, "offline.honest")}</p>
      }
    />
  );
}

export function Caregiving({ locale }: { locale: MarketingLocale }) {
  return (
    <MediaRow
      locale={locale}
      id="s8-care"
      assetId="r6-caregiver"
      mediaLeft
      titleKey="care.h2"
      bodyKey="care.body"
      mediaLabelKey="care.media_label"
      extra={<p style={{ marginTop: "12px", fontWeight: 700, color: "var(--mkt-primary)" }}>{t(locale, "care.tagline")}</p>}
      cta={
        <div style={{ marginTop: "22px" }}>
          <CtaLink locale={locale} labelKey="care.cta" />
        </div>
      }
    />
  );
}

// ── S9 ── Share with a doctor (Stage 7 CLEARED 2026-08-12) ──────────────────
export function Share({ locale }: { locale: MarketingLocale }) {
  return (
    <MediaRow
      locale={locale}
      id="s9-share"
      assetId="r7-share-doctor"
      titleKey="share.h2"
      bodyKey="share.body"
      mediaLabelKey="share.media_label"
      chips={["share.chip_qr", "share.chip_expires", "share.chip_no_account", "share.chip_revocable"]}
    />
  );
}

// ── S10 ─────────────────────────────────────────────────────────────────────
export function Free({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-panel" aria-labelledby="s10-title">
      <div className="mkt-panel-in on-primary">
        <h2 id="s10-title">{t(locale, "free.h2")}</h2>
        <p style={{ marginTop: "18px", fontSize: "1.0625rem", lineHeight: 1.65 }}>{t(locale, "free.body")}</p>
        <div style={{ marginTop: "24px", display: "flex", justifyContent: "center" }}>
          <ChipRow>
            <Chip onPrimary>{t(locale, "free.chip_no_ads")}</Chip>
            {/* GATE(BUSINESS/LEGAL): "identifiable health information is never
                sold" chip — 04 §S10, MKT-072, lib/content-gates.ts */}
            <Chip onPrimary>{t(locale, "free.chip_no_paywall")}</Chip>
          </ChipRow>
        </div>
        <div style={{ marginTop: "28px" }}>
          <CtaLink locale={locale} invert />
        </div>
      </div>
    </section>
  );
}

// ── S11 ─────────────────────────────────────────────────────────────────────
export function Trust({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-section" aria-labelledby="s11-title">
      <div className="mkt-container">
        <h2 id="s11-title" style={{ maxWidth: "26ch" }}>
          {t(locale, "trust.h2")}
        </h2>
        <div className="mkt-trust">
          <div className="mkt-tcard mkt-does">
            <h3>{t(locale, "trust.does_h3")}</h3>
            <ul>
              <li>{t(locale, "trust.does_1")}</li>
              <li>{t(locale, "trust.does_2")}</li>
              <li>{t(locale, "trust.does_3")}</li>
              <li>{t(locale, "trust.does_4")}</li>
              {/* GATE(CLINICAL): "point out things worth asking your doctor
                  about" — 04 §S11, MKT-030/031/032 */}
              {/* GATE(SECURITY): "share on your terms, and see every access"
                  — 04 §S11, MKT-071 (professional unit era) */}
            </ul>
          </div>
          <div className="mkt-tcard mkt-not">
            <h3>{t(locale, "trust.not_h3")}</h3>
            <ul>
              <li>{t(locale, "trust.not_1")}</li>
              <li>{t(locale, "trust.not_2")}</li>
              <li>{t(locale, "trust.not_3")}</li>
              <li>{t(locale, "trust.not_4")}</li>
              <li>{t(locale, "trust.not_5")}</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── S12 ── Professional bridge (Stage 7 CLEARED) ────────────────────────────
export function ProfessionalBridge({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-section" aria-labelledby="s12-title" style={{ background: "var(--mkt-surface)", textAlign: "center" }}>
      <div className="mkt-container-text">
        <h2 id="s12-title" style={{ fontSize: "1.375rem" }}>
          {t(locale, "bridge.h2")}
        </h2>
        <p className="mkt-muted" style={{ marginTop: "10px", maxWidth: "56ch", marginInline: "auto" }}>
          {t(locale, "bridge.body")}
        </p>
        <p style={{ marginTop: "18px" }}>
          <a href="/for-clinics/" style={{ fontWeight: 700, display: "inline-block", paddingBlock: "4px" }}>
            {t(locale, "bridge.cta")} →
          </a>
        </p>
      </div>
    </section>
  );
}

// ── S13 ─────────────────────────────────────────────────────────────────────
export function Faq({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-section" aria-labelledby="s13-title" style={{ background: "var(--mkt-surface)" }}>
      <div className="mkt-faq" style={{ paddingInline: "var(--mkt-gutter)" }}>
        <h2 id="s13-title">{t(locale, "faq.h2")}</h2>
        <div style={{ marginTop: "16px" }}>
          {FAQ_ITEMS.map(({ q, a }) => (
            <details key={q} className="mkt-faq-item">
              <summary>
                <h3>{t(locale, q)}</h3>
                <span className="mkt-faq-caret" aria-hidden="true">
                  +
                </span>
              </summary>
              <p>{t(locale, a)}</p>
            </details>
          ))}
          {/* GATE(SECURITY): Q5 "Does my doctor need an account?" — 04 §S13 */}
          {/* GATE(CLINICAL): Q6 capability sentence (duplicates) — 04 §S13 */}
        </div>
      </div>
    </section>
  );
}

// ── S14 ─────────────────────────────────────────────────────────────────────
export function FinalCta({ locale }: { locale: MarketingLocale }) {
  return (
    <section className="mkt-section" aria-labelledby="s14-title" style={{ textAlign: "center" }}>
      <div className="mkt-container-text">
        <h2 id="s14-title">{t(locale, "final.h2")}</h2>
        <p className="mkt-muted" style={{ marginTop: "10px" }}>
          {t(locale, "final.sub")}
        </p>
        <div style={{ marginTop: "24px" }}>
          <CtaLink locale={locale} />
        </div>
        <div style={{ marginTop: "24px", display: "flex", justifyContent: "center" }}>
          <QrCard locale={locale} />
        </div>
      </div>
    </section>
  );
}
