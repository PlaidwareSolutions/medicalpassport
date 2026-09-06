"use client";
import { Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { trustBadge, type ActorType, type ProvenanceSource, type VerificationState } from "../lib/health-timeline";

/**
 * The provenance badge on timeline rows and clinical-profile cards
 * (docs_v2/10 H-30). Copy is chosen by `trustBadge()` from `verification`
 * alone — this component adds no mapping of its own, so a patient-entered
 * row can never read "verified" here. Renders nothing when the row carries
 * no verification state.
 */
export function TrustBadge({
  verification,
  actorType,
  provenanceSource,
}: {
  verification: VerificationState | null | undefined;
  actorType?: ActorType | null;
  provenanceSource?: ProvenanceSource | null;
}) {
  const { t } = useI18n();
  const badge = trustBadge({
    verification: verification ?? null,
    actorType: actorType ?? (provenanceSource === "caregiver_entered" ? "caregiver" : "patient"),
    provenanceSource: provenanceSource ?? null,
  });
  if (!badge) return null;
  return <Chip tone={badge.tone}>{t(badge.key)}</Chip>;
}
