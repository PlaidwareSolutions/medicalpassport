"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@medpass/localization";
import { Button, Card } from "@medpass/ui-web";
import { GuideGlyph, type GuideGlyphName } from "../../components/GuideGlyph";
import { ReadAloud } from "../../components/ReadAloud";
import type { GuidanceAudioId } from "../../lib/guidance-audio-entries";
import { useI18n } from "../../lib/i18n";

/**
 * The first-run welcome tour: three audio-backed cards, a warm hello rather
 * than the teaching mechanism (that job belongs to the teaching empty
 * states and the help screen — elders don't retain tours). Reached exactly
 * once by construction: `/onboarding/profile` redirects here after the
 * first profile is created, and that screen is only reachable with zero
 * profiles — no first-run flag exists anywhere, so a re-login can never be
 * blocked by this screen. Replayable any time from /help. Standalone (no
 * AppShell) because the content is static, zero-PHI, and must also work
 * from the public help screen. Cards never auto-play audio — predictability
 * beats cleverness for this audience and for screen readers.
 */
const CARDS: ReadonlyArray<{ glyph: GuideGlyphName; titleKey: MessageKey; bodyKey: MessageKey; audio: GuidanceAudioId }> = [
  { glyph: "tablet", titleKey: "tour.card1_title", bodyKey: "tour.card1_body", audio: "tour.1" },
  { glyph: "bell", titleKey: "tour.card2_title", bodyKey: "tour.card2_body", audio: "tour.2" },
  { glyph: "share", titleKey: "tour.card3_title", bodyKey: "tour.card3_body", audio: "tour.3" },
];

export default function TourPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const card = CARDS[step] ?? CARDS[0]!;
  const last = step === CARDS.length - 1;

  function finish() {
    router.replace("/");
  }

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100dvh",
        padding: "var(--space-xl) var(--space-md)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "var(--space-lg)",
      }}
    >
      <Card>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-md)", textAlign: "center", padding: "var(--space-md) 0" }}>
          <span style={{ color: "var(--color-primary)" }}>
            <GuideGlyph name={card.glyph} size="lg" />
          </span>
          <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{t(card.titleKey)}</h1>
          <p style={{ margin: 0, fontSize: "var(--font-large)" }}>{t(card.bodyKey)}</p>
          <ReadAloud size="md" segments={[{ audio: card.audio }]} />
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-sm)" }}>
        <span aria-hidden="true" style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          {CARDS.map((c, i) => (
            <span
              key={c.audio}
              style={{
                width: "0.6em",
                height: "0.6em",
                borderRadius: "50%",
                background: i === step ? "var(--color-primary)" : "var(--color-border)",
              }}
            />
          ))}
        </span>
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("tour.step", { current: step + 1, total: CARDS.length })}
        </span>
      </div>

      {last ? (
        <Button fullWidth onClick={finish}>
          {t("tour.done")}
        </Button>
      ) : (
        <>
          <Button fullWidth onClick={() => setStep(step + 1)}>
            {t("common.continue")}
          </Button>
          <Button fullWidth variant="ghost" onClick={finish}>
            {t("common.skip")}
          </Button>
        </>
      )}
    </main>
  );
}
