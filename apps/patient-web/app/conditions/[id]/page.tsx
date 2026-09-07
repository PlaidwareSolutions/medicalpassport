"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { GuideGlyph } from "../../../components/GuideGlyph";
import { PageHeader } from "../../../components/PageHeader";
import { TrustBadge } from "../../../components/TrustBadge";
import { useI18n } from "../../../lib/i18n";
import { formatCalendarDate } from "../../../lib/patient-time";
import {
  confirmSuggestion,
  dismissSuggestion,
  suggestionQuestionKey,
  suggestionSubject,
  trackedMeasureLabel,
  trackedMeasureValue,
  useConditionJourney,
  type BeforeAfterDto,
  type BeforeAfterWindow,
  type ClinicalRelationshipDto,
  type TrackedMeasure,
} from "../../../lib/journey";

/**
 * The condition hub (docs_v2/06 P10-3): one screen for everything the record
 * holds around one condition — the medicines taken for it, the tests and
 * measurements that follow it, the doctors involved, and the patient's own
 * numbers either side of a medicine's start date.
 *
 * Two rules run through every block below, and they are the reason the exit
 * gate for this phase is a copy review (M10):
 *
 * - **Nothing here says one thing caused another.** The caveat banner is not
 *   a footnote — it sits above the content, is repeated on each before/after
 *   block, and is written in every locale. Timing is all this screen knows.
 * - **A derived link is a question, not a claim.** Suggestions render as
 *   questions with a Yes and a Not this one; only links the patient
 *   confirmed (or that the medicine's own record states) appear in the
 *   sections above as things that are so.
 */
export default function ConditionHubPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const conditionId = params.id;
  const { journey, error, fromCache, reload } = useConditionJourney(conditionId);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [answerError, setAnswerError] = useState<string | undefined>();

  async function answer(edge: ClinicalRelationshipDto, decision: "confirm" | "dismiss") {
    setBusyId(edge.id);
    setAnswerError(undefined);
    try {
      if (decision === "confirm") await confirmSuggestion(conditionId, edge.id);
      else await dismissSuggestion(conditionId, edge.id);
      await reload();
    } catch (err) {
      setAnswerError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusyId(undefined);
    }
  }

  if (error && !journey) {
    return (
      <AppShell>
        <PageHeader title={t("condition.title")} />
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }

  if (!journey) {
    return (
      <AppShell>
        <PageHeader title={t("condition.title")} />
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const { condition, medicines, results, measurements, doctors, suggestions, beforeAfter } = journey;
  const tracked: TrackedMeasure[] = [...results, ...measurements];

  return (
    <AppShell>
      <PageHeader title={condition.label} readAloud={[{ audio: "screen.condition_hub" }]} />
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      {/*
        The causation caveat, first and unmissable. Every locale carries it
        (docs_v2/10 §1 Observation class, exit gate M10) and the Playwright
        suite asserts it is on the page.
      */}
      <div data-testid="journey-caveat" style={{ marginBottom: "var(--space-sm)" }}>
        <Banner tone="info">{t("journey.caveat")}</Banner>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <strong>{condition.label}</strong>
          {condition.clinicalStatus ? <Chip>{t(`condition.status.${condition.clinicalStatus}` as never)}</Chip> : null}
        </div>
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {condition.onsetDate ? t("condition.since", { date: formatCalendarDate(condition.onsetDate) }) : null}
          {condition.onsetDate && condition.abatementDate ? " · " : null}
          {condition.abatementDate ? t("condition.until", { date: formatCalendarDate(condition.abatementDate) }) : null}
        </div>
        {condition.note ? <span style={{ fontSize: "var(--font-small)" }}>{condition.note}</span> : null}
        <TrustBadge verification={condition.verification} provenanceSource={condition.provenanceSource} />
      </Card>

      {/* ── Medicines ─────────────────────────────────────────────── */}
      {journey.sections.medicines ? (
        <>
          <SectionTitle>{t("journey.medicines_title")}</SectionTitle>
          {medicines.length === 0 ? (
            <Card>
              <span style={{ color: "var(--color-text-muted)" }}>{t("journey.medicines_empty")}</span>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {medicines.map((m) => (
                <Link key={m.id} href={`/medicines/${m.id}`} data-testid={`journey-medicine-${m.id}`}>
                  <Card>
                    <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
                      <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                        <GuideGlyph name="tablet" size="md" />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{m.enteredName}</strong>
                        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                          {m.startDate ? t("journey.started_on", { date: formatCalendarDate(m.startDate) }) : null}
                        </div>
                        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", marginTop: "var(--space-xs)" }}>
                          <Chip>{t(`meds.status.${m.status}` as never)}</Chip>
                          <Chip tone={m.linkSource === "medicine_record" ? "default" : "success"}>
                            {t(m.linkSource === "medicine_record" ? "journey.link.from_record" : "journey.link.confirmed")}
                          </Chip>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── Tests and measurements that follow it ─────────────────── */}
      <SectionTitle>{t("journey.tracked_title")}</SectionTitle>
      {tracked.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("journey.tracked_empty")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {tracked.map((measure) => (
            <Link
              key={`${measure.kind}-${measure.key}`}
              href={measure.kind === "result" ? `/reports/trends/${measure.key}` : `/measurements/${measure.key}/trends`}
              data-testid={`journey-tracked-${measure.key}`}
            >
              <Card>
                <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
                  <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                    <GuideGlyph name={measure.kind === "result" ? "report" : "pulse"} size="md" />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{trackedMeasureLabel(t, measure)}</strong>
                    <div style={{ fontSize: "var(--font-large)" }}>
                      {measure.latest ? `${trackedMeasureValue(measure, measure.latest.value)}${measure.unitDisplay ? ` ${measure.unitDisplay}` : ""}` : "—"}
                    </div>
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {measure.latest ? formatCalendarDate(measure.latest.at) : t("journey.no_readings")}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* ── Doctors ───────────────────────────────────────────────── */}
      <SectionTitle>{t("journey.doctors_title")}</SectionTitle>
      {doctors.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("journey.doctors_empty")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {doctors.map((d) => (
            <Card key={d.id}>
              <strong>{d.displayName}</strong>
              {d.speciality ? <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{d.speciality}</span> : null}
            </Card>
          ))}
        </div>
      )}

      {/* ── Before / after ────────────────────────────────────────── */}
      {beforeAfter.length > 0 ? (
        <>
          <SectionTitle>{t("journey.before_after_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {beforeAfter.map((view) => (
              <BeforeAfterCard key={`${view.medication.id}-${view.measure.key}`} view={view} />
            ))}
          </div>
        </>
      ) : null}

      {/* ── Suggested links, asked as questions ───────────────────── */}
      <SectionTitle>{t("journey.suggestions_title")}</SectionTitle>
      {answerError ? <Banner tone="danger">{answerError}</Banner> : null}
      {suggestions.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("journey.suggestions_empty")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("journey.suggestions_intro")}</span>
          {suggestions.map((edge) => (
            <Card key={edge.id}>
              <div data-testid="journey-suggestion-question" style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
                <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                  <GuideGlyph name="question" size="md" />
                </span>
                {/*
                  Phrased as a question in every locale — never "Metformin is
                  for your diabetes", always "Is Metformin for … ?".
                */}
                <strong style={{ minWidth: 0 }}>
                  {t(suggestionQuestionKey(edge.kind) as never, { subject: suggestionSubject(edge), condition: condition.label, target: edge.to.label ?? "" })}
                </strong>
              </div>
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap", marginTop: "var(--space-sm)" }}>
                <Button
                  loading={busyId === edge.id}
                  disabled={busyId !== undefined}
                  onClick={() => void answer(edge, "confirm")}
                  data-testid={`journey-suggestion-yes-${edge.id}`}
                >
                  {t("journey.answer_yes")}
                </Button>
                <Button variant="secondary" disabled={busyId !== undefined} onClick={() => void answer(edge, "dismiss")}>
                  {t("journey.answer_no")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

/**
 * One medicine × one measure. Three windows, each with the dates it covers
 * and the patient's own readings inside it. Nothing is subtracted, nothing
 * is coloured by direction, and the caveat is repeated here because this is
 * the block a reader is most likely to screenshot on its own.
 */
function BeforeAfterCard({ view }: { view: BeforeAfterDto }) {
  const { t, tn } = useI18n();
  const unit = view.measure.unitDisplay ?? view.measure.unit ?? "";
  const valueOf = (w: BeforeAfterWindow) => {
    if (w.average === null) return t("journey.window_no_readings");
    const primary = trackedMeasureValue(view.measure, w.average);
    const both = w.average2 === null ? primary : `${primary}/${trackedMeasureValue(view.measure, w.average2)}`;
    return unit ? `${both} ${unit}` : both;
  };

  return (
    <Card>
      <strong>{t("journey.before_after_heading", { medicine: view.medication.enteredName, measure: trackedMeasureLabel(t, view.measure) })}</strong>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("journey.started_on", { date: formatCalendarDate(view.medication.startDate) })}
      </span>
      <dl style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", margin: "var(--space-sm) 0 0" }}>
        {view.windows.map((w) => (
          <div key={w.key} data-testid={`journey-window-${w.key}`} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <dt style={{ minWidth: 0 }}>
              {t(`journey.window.${w.key}` as never)}
              <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {t("journey.window_dates", { from: formatCalendarDate(w.from), to: formatCalendarDate(w.to) })}
                {" · "}
                {tn(w.count, "journey.window_count_one", "journey.window_count")}
              </span>
            </dt>
            <dd style={{ margin: 0, fontSize: "var(--font-large)", whiteSpace: "nowrap" }}>{valueOf(w)}</dd>
          </div>
        ))}
      </dl>
      <div style={{ marginTop: "var(--space-sm)" }}>
        <Banner tone="info">{t("journey.before_after_caveat")}</Banner>
      </div>
    </Card>
  );
}
