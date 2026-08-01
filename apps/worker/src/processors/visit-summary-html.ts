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
 * no error anywhere. Any new section must be added in both places.
 */
export interface VisitSummaryDto {
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null };
  generatedAt: string;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  conditions?: Array<{ label: string; note: string | null }>;
  currentMedications?: Array<{
    id: string;
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  recentChanges?: Array<{ medicationName: string; change: string; occurredAt: string }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
  glucoseReadings?: {
    readingCount: number;
    averageMgDl: number | null;
    lowestMgDl: number | null;
    highestMgDl: number | null;
    byContext: Array<{ context: string; count: number; averageMgDl: number }>;
    recent: Array<{ valueMgDl: number; context: string; measuredAt: string; note: string | null }>;
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
  reports?: Array<{
    kind: string;
    label: string | null;
    facilityName: string | null;
    practitionerName: string | null;
    testedAt: string | null;
    notes: string | null;
    documentCount: number;
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

const REPORT_KIND_LABELS: Record<string, string> = {
  blood_test: "Blood test",
  urine_test: "Urine test",
  imaging: "Imaging / scan",
  ecg: "ECG / heart test",
  pathology: "Pathology / biopsy",
  discharge_summary: "Discharge summary",
  other: "Other test",
};

function reportKindLabel(kind: string): string {
  return REPORT_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
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
              .map((c) => `<li>${esc(c.medicationName)} — ${esc(c.change.replace(/_/g, " "))} <span class="muted">(${formatDate(c.occurredAt)})</span></li>`)
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
                return `<tr><td><strong>${esc(reportKindLabel(r.kind))}</strong>${r.label ? `<br>${esc(r.label)}` : ""}</td><td>${r.testedAt ? esc(formatDateOnly(r.testedAt)) : "<span class=\"muted\">Not recorded</span>"}</td><td>${where.length ? where.join("<br>") : "—"}</td><td>${esc(r.notes) || "—"}</td><td>${r.documentCount || "—"}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : "<p class=\"muted\">No test reports in this period.</p>",
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
