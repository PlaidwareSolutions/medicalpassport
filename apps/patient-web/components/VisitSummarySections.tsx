"use client";
import type { VisitSummaryDto } from "@medpass/api-client";
import { Card, Chip, SectionTitle } from "@medpass/ui-web";
import { apiBaseUrl } from "../lib/api-origin";
import { useI18n } from "../lib/i18n";
import { medicationChangeSentence } from "../lib/medication-changes";
import { formatCalendarDate, formatPatientDate, formatPatientDateTime } from "../lib/patient-time";

const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  info: "default",
  low: "default",
  moderate: "warning",
  high: "danger",
};

const COLUMN = { display: "flex", flexDirection: "column", gap: "var(--space-sm)" } as const;
const MUTED_SMALL = { color: "var(--color-text-muted)", fontSize: "var(--font-small)" } as const;

/**
 * V2 `DiagnosticReportKind` values that have no `reports.kind.*` key of
 * their own — the diagnostics screen already names them. The two report
 * vocabularies overlap on imaging/ecg/pathology/other (which keep the V1
 * key) and are otherwise disjoint, so one lookup covers the merged list.
 */
const DIAGNOSTIC_KIND_KEYS: Record<string, string> = {
  laboratory: "dx.kind.laboratory",
  echo: "dx.kind.echo",
  microbiology: "dx.kind.microbiology",
  genetics: "dx.kind.genetics",
};

/** Date-only values (`YYYY-MM-DD`) must not go through a timezone-shifting Date parse or render. */
function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return formatCalendarDate(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * The summary body shared by doctor-visit mode (docs/07 screen 28) and the
 * public share view (screen 29) — the two screens render identical content
 * and differ only in their surrounding chrome, so they render this rather
 * than keeping two copies in sync by hand.
 *
 * An absent section means "not shared"; an empty one means "shared, nothing
 * recorded" — both render nothing here, matching the existing behavior of
 * these screens (unlike the PDF/WhatsApp exports, which show the heading
 * plus an explicit "none recorded" line).
 */
export function VisitSummarySections({
  data,
  concernTones = true,
  shareToken,
}: {
  data: VisitSummaryDto;
  concernTones?: boolean;
  /**
   * Present only on the public share view. The document pages live behind
   * `GET /v1/public/shares/:token/documents/:id/pages/:n`, so without a
   * token the documents section lists what is on file and shows no images —
   * which is also exactly right for the pre-send preview, where the patient
   * is looking at their own record and the link does not exist yet.
   */
  shareToken?: string;
}) {
  const { t, tn } = useI18n();

  return (
    <>
      {data.allergies && data.allergies.length > 0 ? (
        <>
          <SectionTitle>{t("profile.allergies")}</SectionTitle>
          <div style={COLUMN}>
            {data.allergies.map((a, i) => (
              <Card key={i} tone={a.severity === "severe" ? "danger" : "default"}>
                <strong>{a.label}</strong> <Chip>{t(`allergy.severity.${a.severity}` as never)}</Chip>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.conditions && data.conditions.length > 0 ? (
        <>
          <SectionTitle>{t("profile.conditions")}</SectionTitle>
          <div style={COLUMN}>
            {data.conditions.map((c, i) => (
              <Card key={i}>
                <strong>{c.label}</strong>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.currentMedications && data.currentMedications.length > 0 ? (
        <>
          <SectionTitle>{t("meds.current")}</SectionTitle>
          <div style={COLUMN}>
            {data.currentMedications.map((m, i) => (
              <Card key={i}>
                <strong style={{ fontSize: "var(--font-large)" }}>{m.name}</strong>
                <span style={MUTED_SMALL}>
                  {m.ingredients.join(" + ")} {m.strengthLabel ?? ""}
                </span>
                <span style={{ fontSize: "var(--font-small)" }}>{m.instructionSummary}</span>
                {m.prescriberName ? <span style={MUTED_SMALL}>{t("meds.prescribed_by", { name: m.prescriberName })}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.glucoseReadings && data.glucoseReadings.readingCount > 0 ? (
        <>
          <SectionTitle>{t("visit.blood_sugar")}</SectionTitle>
          <Card>
            <strong style={{ fontSize: "var(--font-large)" }}>
              {t("visit.glucose_average", { value: String(data.glucoseReadings.averageMgDl) })}
            </strong>
            <span style={MUTED_SMALL}>
              {tn(data.glucoseReadings.readingCount, "visit.glucose_summary_one", "visit.glucose_summary", {
                low: String(data.glucoseReadings.lowestMgDl),
                high: String(data.glucoseReadings.highestMgDl),
              })}
            </span>
            <div style={{ marginTop: "var(--space-xs)" }}>
              {data.glucoseReadings.byContext.map((c) => (
                <div key={c.context} style={{ fontSize: "var(--font-small)" }}>
                  {t(`bloodsugar.context.${c.context}` as never)}: {c.averageMgDl} {t("bloodsugar.mg_dl_unit")} ({c.count})
                </div>
              ))}
            </div>
          </Card>
          <div style={{ ...COLUMN, marginTop: "var(--space-sm)" }}>
            {data.glucoseReadings.recent.map((r, i) => (
              <Card key={i}>
                <strong>
                  {r.valueMgDl} {t("bloodsugar.mg_dl_unit")}
                </strong>
                <span style={MUTED_SMALL}>
                  {t(`bloodsugar.context.${r.context}` as never)} · {formatPatientDateTime(r.measuredAt, data.profile.timezone)}
                </span>
                {r.note ? <span style={MUTED_SMALL}>{r.note}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.bloodPressureReadings && data.bloodPressureReadings.readingCount > 0 ? (
        <>
          <SectionTitle>{t("visit.blood_pressure")}</SectionTitle>
          <Card>
            <strong style={{ fontSize: "var(--font-large)" }}>
              {t("visit.bp_average", {
                systolic: String(data.bloodPressureReadings.averageSystolic),
                diastolic: String(data.bloodPressureReadings.averageDiastolic),
              })}
            </strong>
            <span style={MUTED_SMALL}>{tn(data.bloodPressureReadings.readingCount, "visit.bp_summary_one", "visit.bp_summary")}</span>
          </Card>
          <div style={{ ...COLUMN, marginTop: "var(--space-sm)" }}>
            {data.bloodPressureReadings.recent.map((r, i) => (
              <Card key={i}>
                <strong>
                  {r.systolic}/{r.diastolic} {t("bp.mmhg_unit")}
                </strong>
                <span style={MUTED_SMALL}>
                  {r.pulseBpm != null ? <>{t("bp.pulse_short", { value: String(r.pulseBpm) })} · </> : null}
                  {formatPatientDateTime(r.measuredAt, data.profile.timezone)}
                </span>
                {r.note ? <span style={MUTED_SMALL}>{r.note}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.weightReadings && data.weightReadings.readingCount > 0 ? (
        <>
          <SectionTitle>{t("visit.body_weight")}</SectionTitle>
          <Card>
            <strong style={{ fontSize: "var(--font-large)" }}>
              {data.weightReadings.latestKg} {t("weight.kg_unit")}
            </strong>
            <span style={MUTED_SMALL}>
              {tn(data.weightReadings.readingCount, "visit.weight_summary_one", "visit.weight_summary")}
              {data.weightReadings.changeKg != null
                ? ` · ${t("visit.weight_change", {
                    value: `${Number(data.weightReadings.changeKg) > 0 ? "+" : ""}${data.weightReadings.changeKg}`,
                  })}`
                : null}
            </span>
          </Card>
          <div style={{ ...COLUMN, marginTop: "var(--space-sm)" }}>
            {data.weightReadings.recent.map((r, i) => (
              <Card key={i}>
                <strong>
                  {r.weightKg} {t("weight.kg_unit")}
                </strong>
                <span style={MUTED_SMALL}>{formatPatientDateTime(r.measuredAt, data.profile.timezone)}</span>
                {r.note ? <span style={MUTED_SMALL}>{r.note}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.checkups && data.checkups.length > 0 ? (
        <>
          <SectionTitle>{t("visit.checkups")}</SectionTitle>
          <div style={COLUMN}>
            {data.checkups.map((c, i) => (
              <Card key={i}>
                <strong>{formatDateOnly(c.checkupDate)}</strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", ...MUTED_SMALL }}>
                  {/* Only what was actually measured — never zero-filled. */}
                  {c.fastingGlucoseMgDl != null ? <span>{t("bloodsugar.fasting_glucose_label")}: {c.fastingGlucoseMgDl}</span> : null}
                  {c.postPrandialGlucoseMgDl != null ? <span>{t("bloodsugar.pp_glucose_label")}: {c.postPrandialGlucoseMgDl}</span> : null}
                  {c.hba1cPercent != null ? <span>{t("bloodsugar.hba1c_label")}: {c.hba1cPercent}</span> : null}
                  {c.bloodPressureSystolic != null && c.bloodPressureDiastolic != null ? (
                    <span>
                      {t("bloodsugar.bp_systolic_label")}/{t("bloodsugar.bp_diastolic_label")}: {c.bloodPressureSystolic}/
                      {c.bloodPressureDiastolic}
                    </span>
                  ) : null}
                  {c.weightKg != null ? <span>{t("bloodsugar.weight_label")}: {c.weightKg}</span> : null}
                  {c.waistCircumferenceCm != null ? <span>{t("bloodsugar.waist_label")}: {c.waistCircumferenceCm}</span> : null}
                  {c.cholesterolMgDl != null ? <span>{t("bloodsugar.cholesterol_label")}: {c.cholesterolMgDl}</span> : null}
                  {c.treatmentChanges ? <span>{t("bloodsugar.treatment_changes_label")}: {c.treatmentChanges}</span> : null}
                  {c.nextAppointmentDate ? (
                    <span>
                      {t("bloodsugar.next_appointment_label")}: {formatDateOnly(c.nextAppointmentDate)}
                    </span>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.prescriptions && data.prescriptions.length > 0 ? (
        <>
          <SectionTitle>{t("visit.prescriptions")}</SectionTitle>
          <div style={COLUMN}>
            {data.prescriptions.map((p, i) => (
              <Card key={i}>
                <strong>{p.practitionerName ?? t("prescriptions.unnamed_doctor")}</strong>
                <span style={MUTED_SMALL}>
                  {p.prescribedAt ? formatDateOnly(p.prescribedAt) : t("prescriptions.no_date")}
                </span>
                <span style={MUTED_SMALL}>
                  {t("prescriptions.medication_count", { count: p.medicationCount })} ·{" "}
                  {t("prescriptions.document_count", { count: p.documentCount })}
                </span>
                {p.notes ? <span style={MUTED_SMALL}>{p.notes}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.reports && data.reports.length > 0 ? (
        <>
          <SectionTitle>{t("visit.reports")}</SectionTitle>
          <div style={COLUMN}>
            {data.reports.map((r, i) => (
              <Card key={i}>
                <strong>{t((DIAGNOSTIC_KIND_KEYS[r.kind] ?? `reports.kind.${r.kind}`) as never)}</strong>
                {r.label ? <span style={{ fontSize: "var(--font-small)" }}>{r.label}</span> : null}
                <span style={MUTED_SMALL}>{r.testedAt ? formatDateOnly(r.testedAt) : t("reports.no_date")}</span>
                {r.facilityName ? <span style={MUTED_SMALL}>{r.facilityName}</span> : null}
                {r.practitionerName ? <span style={MUTED_SMALL}>{t("reports.ordered_by", { name: r.practitionerName })}</span> : null}
                {r.notes ? <span style={MUTED_SMALL}>{r.notes}</span> : null}
                {/* Verbatim as transcribed, with the unit as printed —
                    never a high/low/normal judgement (H-25, H-39). */}
                {r.values && r.values.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--font-small)" }}>
                    {r.values.map((v, vi) => (
                      <span key={vi}>
                        {v.label}: {v.enteredValue}
                        {v.unit ? ` ${v.unit}` : ""}
                        {v.referenceText ? <span style={MUTED_SMALL}> ({v.referenceText})</span> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
                {r.documentCount > 0 ? <span style={MUTED_SMALL}>{t("reports.document_count", { count: r.documentCount })}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* V2 Observation aggregates. Numbers as recorded, in the concept's
          canonical unit — count, lowest, highest, average and nothing else.
          No colour, no band, no "normal": this is arithmetic on the
          patient's own readings, not a reading of them (H-25). */}
      {data.measurements && data.measurements.length > 0 ? (
        <>
          <SectionTitle>{t("visit.measurements")}</SectionTitle>
          <div style={COLUMN}>
            {data.measurements.map((m) => (
              <Card key={m.concept}>
                <strong style={{ fontSize: "var(--font-large)" }}>{t(`measure.concept.${m.concept}` as never)}</strong>
                {m.latest ? (
                  <span>
                    {m.latest.value}
                    {m.latest.value2 ? `/${m.latest.value2}` : ""} {m.unit}
                    <span style={MUTED_SMALL}>
                      {" · "}
                      {formatPatientDateTime(m.latest.measuredAt, data.profile.timezone)}
                      {m.latest.context ? ` · ${t(`measure.context.${m.latest.context}` as never)}` : ""}
                    </span>
                  </span>
                ) : null}
                <span style={MUTED_SMALL}>
                  {m.minimum != null && m.maximum != null
                    ? t("visit.measurement_summary", { count: m.count, low: m.minimum, high: m.maximum })
                    : t("visit.measurement_count", { count: m.count })}
                  {m.average != null
                    ? ` · ${t("visit.measurement_average", {
                        value: `${m.average}${m.average2 != null ? `/${m.average2}` : ""} ${m.unit}`,
                      })}`
                    : null}
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.encounters && data.encounters.length > 0 ? (
        <>
          <SectionTitle>{t("visit.encounters")}</SectionTitle>
          <div style={COLUMN}>
            {data.encounters.map((e, i) => (
              <Card key={i}>
                <strong>{t(`encounter.kind.${e.kind}` as never)}</strong>
                <span style={MUTED_SMALL}>
                  {formatPatientDateTime(e.startedAt, data.profile.timezone)}
                  {e.endedAt ? ` – ${formatPatientDateTime(e.endedAt, data.profile.timezone)}` : ""}
                </span>
                {e.organizationName || e.practitionerName ? (
                  <span style={MUTED_SMALL}>{[e.organizationName, e.practitionerName].filter(Boolean).join(" · ")}</span>
                ) : null}
                {e.reasonText ? (
                  <span style={{ fontSize: "var(--font-small)" }}>{t("visit.encounter_reason", { text: e.reasonText })}</span>
                ) : null}
                {e.diagnosisText ? (
                  <span style={{ fontSize: "var(--font-small)" }}>{t("visit.encounter_diagnosis", { text: e.diagnosisText })}</span>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* Documents are only ever present when the share chose them by name
          (never on the default share), and the pages themselves need the
          token — so on the patient's own screens this stays a list. */}
      {data.documents && data.documents.length > 0 ? (
        <>
          <SectionTitle>{t("visit.documents")}</SectionTitle>
          <div style={COLUMN}>
            {data.documents.map((d) => (
              <Card key={d.id}>
                <strong>{d.title ?? t(`documents.kind.${d.kind}` as never)}</strong>
                <span style={MUTED_SMALL}>
                  {[
                    d.title ? t(`documents.kind.${d.kind}` as never) : null,
                    d.documentDate
                      ? formatDateOnly(d.documentDate)
                      : t("visit.document_uploaded", { date: formatPatientDate(d.uploadedAt, data.profile.timezone) }),
                    tn(d.pageCount, "visit.document_pages_one", "visit.document_pages"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {shareToken && d.pageCount > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}>
                    {Array.from({ length: d.pageCount }, (_, n) => n + 1).map((pageNumber) => (
                      // eslint-disable-next-line @next/next/no-img-element -- the page route 302s to a short-lived signed URL, which next/image's optimizer cannot follow or cache.
                      <img
                        key={pageNumber}
                        // The route 302s to a short-lived signed URL and logs
                        // every access, so each page is fetched by number
                        // rather than handed out as a stored link.
                        src={`${apiBaseUrl()}/v1/public/shares/${shareToken}/documents/${d.id}/pages/${pageNumber}`}
                        alt={t("documents.page_alt", { n: pageNumber })}
                        loading="lazy"
                        style={{ width: "100%", height: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}
                      />
                    ))}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.unresolvedConcerns && data.unresolvedConcerns.length > 0 ? (
        <>
          <SectionTitle>{t("home.concerns")}</SectionTitle>
          <div style={COLUMN}>
            {data.unresolvedConcerns.map((c, i) => (
              <Card key={i} tone={concernTones ? SEVERITY_TONE[c.severity] : "default"}>
                <strong>{t(`safety.finding.${c.category}` as never)}</strong>
                <span style={{ fontSize: "var(--font-small)" }}>{c.summary}</span>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.recentChanges && data.recentChanges.length > 0 ? (
        <>
          <SectionTitle>{t("visit.recent_changes")}</SectionTitle>
          <div style={COLUMN}>
            {data.recentChanges.slice(0, 5).map((c, i) => (
              <Card key={i}>
                <span style={{ fontSize: "var(--font-small)" }}>
                  {/* Never the raw action code — see lib/medication-changes.ts. */}
                  {c.medicationName} — {medicationChangeSentence(t, c.change, c.statusTo)} (
                  {formatPatientDate(c.occurredAt, data.profile.timezone)})
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
