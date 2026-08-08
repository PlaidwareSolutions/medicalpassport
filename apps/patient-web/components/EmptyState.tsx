"use client";
import Link from "next/link";
import { Button, Card } from "@medpass/ui-web";
import type { MessageKey } from "@medpass/localization";
import type { GuidanceAudioId } from "../lib/guidance-audio-entries";
import { useI18n } from "../lib/i18n";
import { GuideGlyph, type GuideGlyphName } from "./GuideGlyph";
import { ReadAloud } from "./ReadAloud";

/**
 * A teaching empty state (docs/07 shared defaults, docs/33): elders learn in
 * context at the moment of need, not from tours — so the first visit to an
 * empty screen is exactly where the screen explains itself. One glyph, one
 * plain-language purpose sentence, a listen button, and at most one action.
 * The body deliberately uses full-contrast text, not the muted grey the old
 * one-line empties used — this copy is the screen's content, not a footnote.
 */
export function EmptyState({
  glyph,
  titleKey,
  bodyKey,
  audioId,
  cta,
  tone,
}: {
  glyph: GuideGlyphName;
  titleKey: MessageKey;
  /** ONE sentence of purpose (~5th-grade, docs/33) — why this screen exists, not what it does. */
  bodyKey: MessageKey;
  /** Pre-generated audio of title+body; falls back to browser TTS until generated. */
  audioId?: GuidanceAudioId;
  cta?: { labelKey: MessageKey } & ({ href: string } | { onClick: () => void });
  tone?: "info";
}) {
  const { t } = useI18n();
  return (
    <Card tone={tone}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)", textAlign: "center", padding: "var(--space-sm) 0" }}>
        <span style={{ color: "var(--color-primary)" }}>
          <GuideGlyph name={glyph} size="lg" />
        </span>
        <strong style={{ fontSize: "var(--font-large)" }}>{t(titleKey)}</strong>
        <p style={{ margin: 0 }}>{t(bodyKey)}</p>
        <ReadAloud segments={audioId ? [{ audio: audioId }] : [{ text: `${t(titleKey)} ${t(bodyKey)}` }]} />
        {cta ? (
          "href" in cta ? (
            <Link href={cta.href} style={{ width: "100%" }}>
              <Button fullWidth>{t(cta.labelKey)}</Button>
            </Link>
          ) : (
            <Button fullWidth onClick={cta.onClick}>
              {t(cta.labelKey)}
            </Button>
          )
        ) : null}
      </div>
    </Card>
  );
}
