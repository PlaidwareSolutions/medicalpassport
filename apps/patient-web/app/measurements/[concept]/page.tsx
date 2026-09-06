"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { ObservationEntrySheet } from "../../../components/ObservationEntrySheet";
import { PageHeader } from "../../../components/PageHeader";
import { TrustBadge } from "../../../components/TrustBadge";
import type { GuidanceAudioId } from "../../../lib/guidance-audio-entries";
import { useI18n } from "../../../lib/i18n";
import { conceptGlyph, deleteObservation, displayUnit, isHubConcept, observationValueText, useObservations, type HubConcept } from "../../../lib/observations";
import { formatPatientDateTime, useActiveTimezone } from "../../../lib/patient-time";
import type { SpeechSegment } from "../../../lib/read-aloud";

/** The V1 diaries had pre-generated screen audio; their hub twins keep speaking it. */
const SCREEN_AUDIO: Partial<Record<HubConcept, GuidanceAudioId>> = {
  blood_glucose: "screen.blood_sugar",
  blood_pressure: "screen.blood_pressure",
  body_weight: "screen.body_weight",
};

/**
 * One concept's diary (docs_v2/06 P5-3): newest first, each reading with
 * its context and the patient-local time, an add sheet with the
 * concept's own inputs, and the way to its trend. A reading is a number
 * the patient recorded — nothing here colours or labels it (H-25).
 */
export default function MeasurementDiaryPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const params = useParams<{ concept: string }>();
  const concept = isHubConcept(params.concept) ? params.concept : undefined;
  const { items, error, reload, fromCache } = useObservations(concept);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  if (!concept) {
    return (
      <AppShell>
        <Banner tone="danger">{t("measure.unknown_concept")}</Banner>
        <Link href="/measurements">
          <Button variant="secondary" fullWidth>
            {t("measure.title")}
          </Button>
        </Link>
      </AppShell>
    );
  }

  async function remove(id: string) {
    if (!window.confirm(t("bp.delete_confirm"))) return;
    setDeletingId(id);
    setActionError(undefined);
    try {
      await deleteObservation(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setDeletingId(undefined);
    }
  }

  const audio = SCREEN_AUDIO[concept];
  const readAloud: SpeechSegment[] = audio ? [{ audio }] : [{ text: t("guide.screen.measurement_diary", { name: t(`measure.concept.${concept}` as never) }) }];

  return (
    <AppShell>
      <PageHeader title={t(`measure.concept.${concept}` as never)} readAloud={readAloud} />
      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        <Link href={`/measurements/${concept}/trends`} style={{ flex: "1 1 45%" }}>
          <Button variant="secondary" fullWidth>
            {t("measure.see_trend")}
          </Button>
        </Link>
        {concept === "blood_glucose" ? (
          <Link href="/measurements/checkups" style={{ flex: "1 1 45%" }}>
            <Button variant="secondary" fullWidth>
              {t("bloodsugar.tab_checkups")}
            </Button>
          </Link>
        ) : null}
      </div>

      {showForm ? (
        <ObservationEntrySheet
          concept={concept}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await reload();
          }}
        />
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("bp.add_reading")}
        </Button>
      )}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph={conceptGlyph(concept)} titleKey="bp.empty_title" bodyKey={`measure.empty.${concept}` as never} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((o) => (
            <Card key={o.id} data-testid="observation-row" data-concept={o.concept}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: "var(--font-large)" }} data-testid="observation-value">
                    {observationValueText(o)}
                  </strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
                    {o.context ? <Chip>{t(`measure.context.${o.context}` as never)}</Chip> : null}
                    <span>{formatPatientDateTime(o.measuredAt, timezone)}</span>
                  </div>
                  {o.enteredUnit && o.enteredValueText && displayUnit(undefined, o.enteredUnit) !== displayUnit(o.concept, o.unit) ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {t("measure.entered_as", { value: o.enteredValueText, unit: displayUnit(undefined, o.enteredUnit) })}
                    </div>
                  ) : null}
                  {o.notes ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{o.notes}</div> : null}
                  <div style={{ marginTop: "var(--space-xs)" }}>
                    <TrustBadge verification={o.verification} provenanceSource={o.provenanceSource} />
                  </div>
                </div>
                <Button variant="danger" loading={deletingId === o.id} disabled={deletingId === o.id} onClick={() => void remove(o.id)}>
                  {t("bp.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
