"use client";
import Link from "next/link";
import { direction } from "@medpass/localization";
import { Card } from "@medpass/ui-web";
import { eventGlyph, eventHref, eventSentence, localTimeParts, showsTime, type HealthEventDto } from "../lib/health-timeline";
import { useI18n } from "../lib/i18n";
import { GuideGlyph } from "./GuideGlyph";
import { TrustBadge } from "./TrustBadge";

/**
 * One row of the Health Timeline (docs_v2/06 P1-4): a glyph for the kind,
 * the patient-local time, one plain sentence built from `summary`, and the
 * trust badge. Wrapped in a link only when a detail screen exists for the
 * entity — a row that goes nowhere is not made to look tappable.
 */
export function HealthEventRow({ event }: { event: HealthEventDto }) {
  const { t, locale } = useI18n();
  const rtl = direction(locale) === "rtl";
  const href = eventHref(event);
  const time = showsTime(event) ? localTimeParts(event) : null;
  const timeLabel = time ? new Date(2000, 0, 1, time.hour, time.minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const body = (
    <Card style={{ flexDirection: "row", alignItems: "flex-start", gap: "var(--space-md)" }} data-event-kind={event.kind}>
      <span
        style={{
          width: "2.6em",
          height: "2.6em",
          borderRadius: "50%",
          background: "var(--color-primary-soft)",
          color: "var(--color-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <GuideGlyph name={eventGlyph(event)} size="md" />
      </span>
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        {timeLabel ? <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{timeLabel}</span> : null}
        <span style={{ fontWeight: 600 }}>{eventSentence(t, event)}</span>
        <span style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <TrustBadge verification={event.verification} actorType={event.actorType} provenanceSource={event.provenanceSource} />
        </span>
      </span>
      {href ? (
        <svg
          width="0.9em"
          height="0.9em"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
          style={{ flexShrink: 0, alignSelf: "center", color: "var(--color-text-muted)", transform: rtl ? "scaleX(-1)" : undefined }}
        >
          <path d="M34 14l36 36-36 36" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
