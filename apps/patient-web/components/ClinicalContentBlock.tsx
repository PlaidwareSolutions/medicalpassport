"use client";
import type { ClinicalContentEntryDto } from "@medpass/api-client";
import { Card, SectionTitle } from "@medpass/ui-web";
import { ReadAloud } from "./ReadAloud";

/**
 * One docs/07 screen 19/26 labeled block — approved clinical content or the
 * mandated no-data fallback; source/last-reviewed provenance shown
 * alongside, never a bare claim. Shared by the medicine detail screen and
 * the missed-dose state (DoseCard).
 */
export function ClinicalContentBlock({
  title,
  entry,
  emptyMessage,
  t,
}: {
  title: string;
  entry?: ClinicalContentEntryDto | null;
  emptyMessage: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card tone="info">
        {entry ? (
          <>
            <span>{entry.text}</span>
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("meds.common_uses_source", { source: entry.sourceCitation })}
              {entry.lastReviewedAt ? ` — ${t("meds.common_uses_reviewed", { date: new Date(entry.lastReviewedAt).toLocaleDateString() })}` : ""}
            </div>
            {/* Reads the FULL approved text — a truncated warning would be a
                new hazard (docs/02 four-statement contract). Dynamic content,
                so browser TTS only: where no matching voice exists (te/ur on
                Safari) the button honestly disappears and text stays primary
                (docs/32). */}
            <ReadAloud segments={[{ text: entry.text }]} />
          </>
        ) : (
          // No clinical reviewer has approved content for this medicine/kind yet — never fabricate.
          <span>{emptyMessage}</span>
        )}
      </Card>
    </>
  );
}
