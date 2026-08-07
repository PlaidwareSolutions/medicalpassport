"use client";
import { useEffect, useId } from "react";
import { Button } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { stopReadAloudIfOwner, useReadAloud, type SpeechSegment } from "../lib/read-aloud";
import { GuideGlyph } from "./GuideGlyph";

/**
 * The listen button (docs/07 screen 20). Renders nothing when no segment is
 * playable in the current locale/browser — an honest absence beats a button
 * that silently does nothing (docs/32: text always primary). `md` is the
 * screen-header size and carries the speed toggle; `sm` sits inline on cards
 * and clinical blocks.
 */
export function ReadAloud({ segments, size = "sm" }: { segments: SpeechSegment[]; size?: "sm" | "md" }) {
  const { t, locale } = useI18n();
  const readAloud = useReadAloud();
  const id = useId();
  const playing = readAloud.playingOwner === id;

  // Leaving the screen mid-sentence must not leave the voice running.
  useEffect(() => () => stopReadAloudIfOwner(id), [id]);

  if (!readAloud.playable(segments, locale)) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
      <Button
        variant="secondary"
        aria-pressed={playing}
        // TODO(analytics): emit `read_aloud_used` here once a client
        // analytics pipeline exists (packages/domain has the event name).
        onClick={() => (playing ? readAloud.stop() : readAloud.play(segments, locale, id))}
      >
        <GuideGlyph name="speaker" size={size === "md" ? "md" : "sm"} />
        {playing ? t("guide.stop") : t("guide.listen")}
      </Button>
      {size === "md" ? (
        <Button
          variant="secondary"
          aria-pressed={readAloud.slow}
          onClick={() => readAloud.setSlow(!readAloud.slow)}
          style={
            readAloud.slow
              ? // Pressed state must be visible, not aria-only (WCAG 1.4.1).
                { background: "var(--color-primary-soft)" }
              : { borderColor: "var(--color-border)", color: "var(--color-text-muted)" }
          }
        >
          {t("guide.slower")}
        </Button>
      ) : null}
    </span>
  );
}
