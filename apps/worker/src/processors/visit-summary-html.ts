/**
 * Mirrors the shape of apps/api's VisitSummaryDto (visit-summary.service.ts)
 * — the API builds the summary and sends it as the job payload, so the
 * worker never touches the database for this job type at all, just
 * renders whatever JSON it's handed. Kept as a plain type here rather than
 * a shared package import since apps/api isn't set up as an importable
 * library (docs/02: no premature abstraction).
 *
 * WARNING: drift here does NOT fail loudly, contrary to what this comment
 * used to claim. The job payload is cast (`as`) in main.ts, so a section
 * added to the API's DTO but not here is silently dropped from the PDF with
 * no error anywhere. Any new section must be added in both places —
 * visit-summary-html.test.ts diffs this interface against the API source
 * so the drift at least fails CI.
 */
export interface VisitSummaryDto {
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null; timezone: string };
  generatedAt: string;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  conditions?: Array<{ label: string; note: string | null }>;
  currentMedications?: Array<{
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  /**
   * `change` stays the raw kind — every renderer has its own label table for
   * it (the app translates, the PDF/text exports print English), and a
   * pre-rendered sentence here would be English on a Telugu screen.
   * `statusTo` carries the one detail a label cannot say on its own: which
   * status a `status_changed` entry moved to. Nothing else from `detail`
   * comes along — this payload is read by whoever holds an unauthenticated
   * link.
   */
  recentChanges?: Array<{ medicationName: string; change: string; statusTo: string | null; occurredAt: string }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
  glucoseReadings?: {
    readingCount: number;
    averageMgDl: number | null;
    lowestMgDl: number | null;
    highestMgDl: number | null;
    byContext: Array<{ context: string; count: number; averageMgDl: number }>;
    recent: Array<{ valueMgDl: number; context: string; measuredAt: string; note: string | null }>;
  };
  bloodPressureReadings?: {
    readingCount: number;
    averageSystolic: number | null;
    averageDiastolic: number | null;
    recent: Array<{ systolic: number; diastolic: number; pulseBpm: number | null; measuredAt: string; note: string | null }>;
  };
  weightReadings?: {
    readingCount: number;
    latestKg: string | null;
    changeKg: string | null;
    recent: Array<{ weightKg: string; measuredAt: string; note: string | null }>;
  };
  checkups?: Array<{
    checkupDate: string;
    fastingGlucoseMgDl: number | null;
    postPrandialGlucoseMgDl: number | null;
    hba1cPercent: string | null;
    bloodPressureSystolic: number | null;
    bloodPressureDiastolic: number | null;
    weightKg: string | null;
    waistCircumferenceCm: string | null;
    cholesterolMgDl: number | null;
    treatmentChanges: string | null;
    nextAppointmentDate: string | null;
  }>;
  prescriptions?: Array<{
    prescribedAt: string | null;
    practitionerName: string | null;
    notes: string | null;
    documentCount: number;
    medicationCount: number;
  }>;
  /**
   * V1 `MedicalReport` rows and V2 `DiagnosticReport` rows in one list,
   * newest first. Metadata only, same reasoning as prescriptions — no
   * document handles on an unauthenticated path.
   *
   * `kind` is whichever vocabulary the row came from: `MedicalReportKind`
   * (blood_test, urine_test, discharge_summary, …) or `DiagnosticReportKind`
   * (laboratory, echo, microbiology, genetics, …). The two overlap on
   * imaging/ecg/pathology/other and are otherwise disjoint, so a renderer
   * can key one label table off the value without needing to know which
   * table the row came from.
   */
  reports?: Array<{
    kind: string;
    label: string | null;
    facilityName: string | null;
    practitionerName: string | null;
    testedAt: string | null;
    notes: string | null;
    documentCount: number;
    /** Label/unit pre-resolved by the API — this renderer never maps analytes. */
    values?: Array<{ label: string; enteredValue: string; unit: string | null; referenceText: string | null }>;
  }>;
  /** V2 Observation aggregates per concept, last 30 days — arithmetic only, never an interpretation. */
  measurements?: Array<{
    concept: string;
    label: string;
    unit: string;
    count: number;
    latest: { value: string; value2: string | null; measuredAt: string; context: string | null } | null;
    minimum: string | null;
    maximum: string | null;
    average: string | null;
    average2: string | null;
  }>;
  /** V2 documents. The id is for the public page route; this renderer never prints it. */
  documents?: Array<{
    id: string;
    kind: string;
    title: string | null;
    documentDate: string | null;
    pageCount: number;
    uploadedAt: string;
  }>;
  encounters?: Array<{
    kind: string;
    startedAt: string;
    endedAt: string | null;
    organizationName: string | null;
    practitionerName: string | null;
    reasonText: string | null;
    diagnosisText: string | null;
  }>;
}

const CONTEXT_LABELS: Record<string, string> = {
  before_breakfast: "Before breakfast",
  after_breakfast: "After breakfast",
  before_lunch: "Before lunch",
  after_lunch: "After lunch",
  before_dinner: "Before dinner",
  after_dinner: "After dinner",
  during_night: "During the night",
  random: "Random",
};

function contextLabel(context: string): string {
  return CONTEXT_LABELS[context] ?? context.replace(/_/g, " ");
}

/**
 * Both report vocabularies in one table: V1 `MedicalReportKind` and V2
 * `DiagnosticReportKind`. They overlap on imaging/ecg/pathology/other and
 * are otherwise disjoint, so one lookup covers a merged list. Kept in step
 * with apps/api's visit-summary-format.ts.
 */
const REPORT_KIND_LABELS: Record<string, string> = {
  blood_test: "Blood test",
  urine_test: "Urine test",
  imaging: "Imaging / scan",
  ecg: "ECG / heart test",
  pathology: "Pathology / biopsy",
  discharge_summary: "Discharge summary",
  other: "Other test",
  laboratory: "Lab test",
  echo: "Echo (heart ultrasound)",
  microbiology: "Culture / microbiology",
  genetics: "Genetic test",
};

function reportKindLabel(kind: string): string {
  return REPORT_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

const MEDICATION_CHANGE_LABELS: Record<string, string> = {
  created: "Added to the list",
  updated: "Details updated",
  status_changed: "Status changed",
  dose_unit_confirmed: "Medicine type confirmed",
  refilled: "Marked as refilled",
  deleted: "Removed from the list",
  reconciled_continue: "Kept on after a visit",
  reconciled_stop: "Stopped after a visit",
};

/**
 * A medication-history entry as a sentence. The raw kind is an internal
 * code — a doctor reading "reconciled_continue" off a printed summary is a
 * bug, not shorthand.
 */
function medicationChangeLabel(change: string, statusTo: string | null): string {
  if (change === "status_changed" && statusTo) return `Marked as ${statusTo.replace(/_/g, " ")}`;
  return MEDICATION_CHANGE_LABELS[change] ?? change.replace(/_/g, " ");
}

/** Date-only values (`YYYY-MM-DD`) must not go through a timezone-shifting Date parse. */
function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

/** Escapes text before interpolating into HTML — every field here can contain patient-entered text. */
function esc(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

/**
 * Renders the same live-aggregated summary (docs/07 screens 28/29) as
 * static, printable HTML — no client-side script, no external assets, so
 * it renders identically under a headless browser as it would on screen.
 * English only this pass (docs/22 scope note); every render carries its
 * own generation timestamp so a printed copy is never mistaken for current
 * if read later (docs/12 H-12).
 */
export function renderVisitSummaryHtml(summary: VisitSummaryDto): string {
  const parts: string[] = [];

  if (summary.allergies) {
    parts.push(
      section(
        "Allergies",
        summary.allergies.length
          ? `<ul>${summary.allergies
              .map((a) => `<li><strong>${esc(a.label)}</strong> — ${esc(a.severity)}${a.reactionNote ? ` (${esc(a.reactionNote)})` : ""}</li>`)
              .join("")}</ul>`
          : "<p class=\"muted\">None recorded.</p>",
      ),
    );
  }

  if (summary.conditions) {
    parts.push(
      section(
        "Conditions",
        summary.conditions.length
          ? `<ul>${summary.conditions.map((c) => `<li><strong>${esc(c.label)}</strong>${c.note ? ` — ${esc(c.note)}` : ""}</li>`).join("")}</ul>`
          : "<p class=\"muted\">None recorded.</p>",
      ),
    );
  }

  if (summary.currentMedications) {
    parts.push(
      section(
        "Current medicines",
        summary.currentMedications.length
          ? `<table><thead><tr><th>Medicine</th><th>Ingredients</th><th>Dosing</th><th>Prescriber</th><th>Since</th></tr></thead><tbody>${summary.currentMedications
              .map(
                (m) =>
                  `<tr><td>${esc(m.name)}${m.strengthLabel ? ` (${esc(m.strengthLabel)})` : ""}</td><td>${esc(m.ingredients.join(", "))}</td><td>${esc(m.instructionSummary)}</td><td>${esc(m.prescriberName) || "—"}</td><td>${esc(m.startDate) || "—"}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : "<p class=\"muted\">No current medicines recorded.</p>",
      ),
    );
  }

  if (summary.recentChanges) {
    parts.push(
      section(
        "Recent changes (last 90 days)",
        summary.recentChanges.length
          ? `<ul>${summary.recentChanges
              .map((c) => `<li>${esc(c.medicationName)} — ${esc(medicationChangeLabel(c.change, c.statusTo))} <span class="muted">(${formatDate(c.occurredAt)})</span></li>`)
              .join("")}</ul>`
          : "<p class=\"muted\">No changes in this period.</p>",
      ),
    );
  }

  if (summary.glucoseReadings) {
    const g = summary.glucoseReadings;
    parts.push(
      section(
        "Blood sugar (last 90 days)",
        g.readingCount
          ? `<p><strong>${g.readingCount} readings</strong> · average ${g.averageMgDl} mg/dL · range ${g.lowestMgDl}–${g.highestMgDl}</p>` +
            (g.byContext.length
              ? `<table><thead><tr><th>When</th><th>Readings</th><th>Average</th></tr></thead><tbody>${g.byContext
                  .map((c) => `<tr><td>${esc(contextLabel(c.context))}</td><td>${c.count}</td><td>${c.averageMgDl} mg/dL</td></tr>`)
                  .join("")}</tbody></table>`
              : "") +
            (g.recent.length
              ? `<h3 class="muted">Most recent</h3><ul>${g.recent
                  .map(
                    (r) =>
                      `<li><strong>${r.valueMgDl} mg/dL</strong> — ${esc(contextLabel(r.context))} <span class="muted">(${formatDate(r.measuredAt)})</span>${r.note ? ` — ${esc(r.note)}` : ""}</li>`,
                  )
                  .join("")}</ul>`
              : "")
          : "<p class=\"muted\">No readings in this period.</p>",
      ),
    );
  }

  if (summary.bloodPressureReadings) {
    const bp = summary.bloodPressureReadings;
    parts.push(
      section(
        "Blood pressure (last 90 days)",
        bp.readingCount
          ? `<p><strong>${bp.readingCount} readings</strong> · average ${bp.averageSystolic}/${bp.averageDiastolic} mmHg</p>` +
            (bp.recent.length
              ? `<h3 class="muted">Most recent</h3><ul>${bp.recent
                  .map(
                    (r) =>
                      `<li><strong>${r.systolic}/${r.diastolic} mmHg</strong>${r.pulseBpm != null ? ` — pulse ${r.pulseBpm}` : ""} <span class="muted">(${formatDate(r.measuredAt)})</span>${r.note ? ` — ${esc(r.note)}` : ""}</li>`,
                  )
                  .join("")}</ul>`
              : "")
          : "<p class=\"muted\">No readings in this period.</p>",
      ),
    );
  }

  if (summary.weightReadings) {
    const w = summary.weightReadings;
    parts.push(
      section(
        "Body weight (last 90 days)",
        w.readingCount
          ? `<p><strong>${w.readingCount} readings</strong> · latest ${esc(w.latestKg ?? "")} kg${
              w.changeKg != null ? ` · change ${Number(w.changeKg) > 0 ? "+" : ""}${esc(w.changeKg)} kg over the period` : ""
            }</p>` +
            (w.recent.length
              ? `<h3 class="muted">Most recent</h3><ul>${w.recent
                  .map(
                    (r) =>
                      `<li><strong>${esc(r.weightKg)} kg</strong> <span class="muted">(${formatDate(r.measuredAt)})</span>${r.note ? ` — ${esc(r.note)}` : ""}</li>`,
                  )
                  .join("")}</ul>`
              : "")
          : "<p class=\"muted\">No readings in this period.</p>",
      ),
    );
  }

  if (summary.checkups) {
    parts.push(
      section(
        "Check-ups (last 90 days)",
        summary.checkups.length
          ? // A metric the doctor didn't record that visit is left out
            // entirely rather than shown as a zero or dash.
            `<table><thead><tr><th>Date</th><th>Measurements</th><th>Treatment changes</th><th>Next appointment</th></tr></thead><tbody>${summary.checkups
              .map((c) => {
                const metrics = [
                  c.fastingGlucoseMgDl != null ? `Fasting glucose: ${c.fastingGlucoseMgDl} mg/dL` : null,
                  c.postPrandialGlucoseMgDl != null ? `Post-meal glucose: ${c.postPrandialGlucoseMgDl} mg/dL` : null,
                  c.hba1cPercent != null ? `HbA1c: ${esc(c.hba1cPercent)}%` : null,
                  c.bloodPressureSystolic != null && c.bloodPressureDiastolic != null
                    ? `Blood pressure: ${c.bloodPressureSystolic}/${c.bloodPressureDiastolic}`
                    : null,
                  c.weightKg != null ? `Weight: ${esc(c.weightKg)} kg` : null,
                  c.waistCircumferenceCm != null ? `Waist: ${esc(c.waistCircumferenceCm)} cm` : null,
                  c.cholesterolMgDl != null ? `Cholesterol: ${c.cholesterolMgDl} mg/dL` : null,
                ].filter(Boolean);
                return `<tr><td>${esc(formatDateOnly(c.checkupDate))}</td><td>${metrics.length ? metrics.join("<br>") : "<span class=\"muted\">Not recorded</span>"}</td><td>${esc(c.treatmentChanges) || "—"}</td><td>${c.nextAppointmentDate ? esc(formatDateOnly(c.nextAppointmentDate)) : "—"}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : "<p class=\"muted\">No check-ups in this period.</p>",
      ),
    );
  }

  if (summary.prescriptions) {
    parts.push(
      section(
        "Prescriptions (last 90 days)",
        summary.prescriptions.length
          ? `<ul>${summary.prescriptions
              .map(
                (p) =>
                  `<li><strong>${esc(p.practitionerName) || "Doctor not recorded"}</strong> <span class="muted">(${p.prescribedAt ? esc(formatDateOnly(p.prescribedAt)) : "date not recorded"})</span> — ${p.medicationCount} medicine(s), ${p.documentCount} file(s)${p.notes ? `<br>${esc(p.notes)}` : ""}</li>`,
              )
              .join("")}</ul>`
          : "<p class=\"muted\">No prescriptions in this period.</p>",
      ),
    );
  }

  if (summary.reports) {
    parts.push(
      section(
        "Test reports (last 90 days)",
        summary.reports.length
          ? // Metadata only — the API deliberately never puts document ids or
            // download URLs in this payload, so there is nothing to link to.
            `<table><thead><tr><th>Test</th><th>Date</th><th>Where / who</th><th>Notes</th><th>Files</th></tr></thead><tbody>${summary.reports
              .map((r) => {
                const where = [esc(r.facilityName), r.practitionerName ? `Ordered by ${esc(r.practitionerName)}` : ""].filter(Boolean);
                // Values verbatim as entered, never flagged or coloured —
                // every field is patient-entered text, so everything is esc()d.
                const values = (r.values ?? [])
                  .map((v) => `${esc(v.label)}: ${esc(v.enteredValue)}${v.unit ? ` ${esc(v.unit)}` : ""}${v.referenceText ? ` <span class="muted">(ref ${esc(v.referenceText)})</span>` : ""}`)
                  .join("<br>");
                const notesCell = [values, esc(r.notes)].filter(Boolean).join("<br>");
                return `<tr><td><strong>${esc(reportKindLabel(r.kind))}</strong>${r.label ? `<br>${esc(r.label)}` : ""}</td><td>${r.testedAt ? esc(formatDateOnly(r.testedAt)) : "<span class=\"muted\">Not recorded</span>"}</td><td>${where.length ? where.join("<br>") : "—"}</td><td>${notesCell || "—"}</td><td>${r.documentCount || "—"}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : "<p class=\"muted\">No test reports in this period.</p>",
      ),
    );
  }

  if (summary.measurements) {
    parts.push(
      section(
        "Home measurements (last 30 days)",
        summary.measurements.length
          ? // Numbers as recorded, in the canonical unit; no flags, no colours (docs/02).
            `<table><thead><tr><th>Measurement</th><th>Latest</th><th>Readings</th><th>Range</th><th>Average</th></tr></thead><tbody>${summary.measurements
              .map((m) => {
                const latest = m.latest
                  ? `<strong>${esc(m.latest.value)}${m.latest.value2 ? `/${esc(m.latest.value2)}` : ""} ${esc(m.unit)}</strong> <span class="muted">(${formatDate(m.latest.measuredAt)}${m.latest.context ? `, ${esc(contextLabel(m.latest.context))}` : ""})</span>`
                  : "—";
                const range = m.minimum != null && m.maximum != null ? `${esc(m.minimum)}–${esc(m.maximum)}` : "—";
                const average = m.average != null ? `${esc(m.average)}${m.average2 != null ? `/${esc(m.average2)}` : ""}` : "—";
                return `<tr><td>${esc(m.label)}</td><td>${latest}</td><td>${m.count}</td><td>${range}</td><td>${average}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : "<p class=\"muted\">No measurements in this period.</p>",
      ),
    );
  }

  if (summary.encounters) {
    parts.push(
      section(
        "Visits (last 90 days)",
        summary.encounters.length
          ? `<ul>${summary.encounters
              .map((e) => {
                const where = [esc(e.organizationName), esc(e.practitionerName)].filter(Boolean).join(" · ");
                const details = [e.reasonText ? `Reason: ${esc(e.reasonText)}` : "", e.diagnosisText ? `Diagnosis: ${esc(e.diagnosisText)}` : ""].filter(Boolean);
                return `<li><strong>${esc(e.kind.replace(/_/g, " "))}</strong> <span class="muted">(${formatDate(e.startedAt)})</span>${where ? ` — ${where}` : ""}${details.length ? `<br>${details.join("<br>")}` : ""}</li>`;
              })
              .join("")}</ul>`
          : "<p class=\"muted\">No visits in this period.</p>",
      ),
    );
  }

  if (summary.documents) {
    parts.push(
      section(
        "Documents on record",
        summary.documents.length
          ? // Titles and dates only — never the document id or a page link;
            // page access is the public share route's business, not the PDF's.
            `<ul>${summary.documents
              .map(
                (d) =>
                  `<li><strong>${esc(d.title) || esc(d.kind.replace(/_/g, " "))}</strong> <span class="muted">(${d.documentDate ? esc(formatDateOnly(d.documentDate)) : `uploaded ${formatDate(d.uploadedAt)}`})</span> — ${d.pageCount} page(s)</li>`,
              )
              .join("")}</ul>`
          : "<p class=\"muted\">No documents.</p>",
      ),
    );
  }

  if (summary.unresolvedConcerns) {
    parts.push(
      section(
        "Unresolved safety concerns",
        summary.unresolvedConcerns.length
          ? `<ul>${summary.unresolvedConcerns
              .map(
                (c) =>
                  `<li><strong>${esc(c.category.replace(/_/g, " "))}</strong> (${esc(c.severity)}) — ${esc(c.summary)}</li>`,
              )
              .join("")}<li class="muted">This may have been prescribed intentionally. Please confirm with a doctor or pharmacist before changing anything.</li></ul>`
          : "<p class=\"muted\">None open.</p>",
      ),
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Medication summary</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1d1f; margin: 0; padding: 32px 40px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #4c5563; font-size: 12px; margin-bottom: 24px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #d4dbd8; padding-bottom: 4px; }
  h3 { font-size: 12px; font-weight: 600; margin: 12px 0 4px; }
  p { margin: 0 0 8px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceff0; font-size: 12px; vertical-align: top; }
  th { color: #4c5563; font-weight: 600; }
  .muted { color: #4c5563; }
  section { break-inside: avoid; }
  footer { margin-top: 24px; font-size: 10px; color: #8a8f96; }
</style>
</head>
<body>
  <h1>${esc(summary.profile.displayName)}</h1>
  <div class="meta">
    ${summary.profile.yearOfBirth ? `Born ${summary.profile.yearOfBirth} · ` : ""}${summary.profile.sex ? `${esc(summary.profile.sex)} · ` : ""}Generated ${formatDate(summary.generatedAt)}
  </div>
  ${parts.join("")}
  <footer>Generated by medpass from the patient's own records. Not a prescription or medical advice. This may not reflect information the patient hasn't recorded.</footer>
</body>
</html>`;
}
