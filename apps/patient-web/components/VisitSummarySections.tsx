"use client";
import type { VisitSummaryDto } from "@medpass/api-client";
import { Card, Chip, SectionTitle } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { formatCalendarDate, formatPatientDate, formatPatientDateTime } from "../lib/patient-time";

const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  info: "default",
  low: "default",
  moderate: "warning",
  high: "danger",
};

const COLUMN = { display: "flex", flexDirection: "column", gap: "var(--space-sm)" } as const;
const MUTED_SMALL = { color: "var(--color-text-muted)", fontSize: "var(--font-small)" } as const;

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
export function VisitSummarySections({ data, concernTones = true }: { data: VisitSummaryDto; concernTones?: boolean }) {
  const { t } = useI18n();

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
              {t("visit.glucose_summary", {
                count: data.glucoseReadings.readingCount,
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
            <span style={MUTED_SMALL}>{t("visit.bp_summary", { count: data.bloodPressureReadings.readingCount })}</span>
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
              {t("visit.weight_summary", { count: data.weightReadings.readingCount })}
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
                <strong>{t(`reports.kind.${r.kind}` as never)}</strong>
                {r.label ? <span style={{ fontSize: "var(--font-small)" }}>{r.label}</span> : null}
                <span style={MUTED_SMALL}>{r.testedAt ? formatDateOnly(r.testedAt) : t("reports.no_date")}</span>
                {r.facilityName ? <span style={MUTED_SMALL}>{r.facilityName}</span> : null}
                {r.practitionerName ? <span style={MUTED_SMALL}>{t("reports.ordered_by", { name: r.practitionerName })}</span> : null}
                {r.notes ? <span style={MUTED_SMALL}>{r.notes}</span> : null}
                {r.documentCount > 0 ? <span style={MUTED_SMALL}>{t("reports.document_count", { count: r.documentCount })}</span> : null}
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
                  {c.medicationName} — {c.change} ({formatPatientDate(c.occurredAt, data.profile.timezone)})
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
