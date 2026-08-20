import type { VisitSummaryDto } from "./visit-summary.service";
import { checkupMetrics, contextLabel, formatDateOnly, reportKindLabel, reportValueLine } from "./visit-summary-format";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** WhatsApp's lightweight markdown: single asterisks for bold, underscores for italic. */
function bold(text: string): string {
  return `*${text}*`;
}

/**
 * Formats a visit summary as plain text for the patient to hand off via
 * WhatsApp's own share intent (docs/07 screen 29 "WhatsApp text summary") —
 * there's no WhatsApp Business API account to send through server-side
 * (OD-10 blocked), so this is the client's own WhatsApp app sending on the
 * patient's behalf, the same way copying the share link already works,
 * just with the readable content itself instead of a link a recipient
 * without connectivity couldn't open anyway. English only this pass,
 * matching the same simplification the SMS templates and PDF export made.
 */
export function renderVisitSummaryText(summary: VisitSummaryDto): string {
  const lines: string[] = [];
  lines.push(bold(summary.profile.displayName));
  const metaBits = [
    summary.profile.yearOfBirth ? `Born ${summary.profile.yearOfBirth}` : null,
    summary.profile.sex,
    `Generated ${formatDate(summary.generatedAt)}`,
  ].filter(Boolean);
  lines.push(metaBits.join(" · "));
  lines.push("");

  if (summary.allergies) {
    lines.push(bold("Allergies"));
    if (summary.allergies.length === 0) lines.push("None recorded.");
    else for (const a of summary.allergies) lines.push(`- ${a.label} — ${a.severity}${a.reactionNote ? ` (${a.reactionNote})` : ""}`);
    lines.push("");
  }

  if (summary.conditions) {
    lines.push(bold("Conditions"));
    if (summary.conditions.length === 0) lines.push("None recorded.");
    else for (const c of summary.conditions) lines.push(`- ${c.label}${c.note ? ` — ${c.note}` : ""}`);
    lines.push("");
  }

  if (summary.currentMedications) {
    lines.push(bold("Current medicines"));
    if (summary.currentMedications.length === 0) lines.push("No current medicines recorded.");
    else
      for (const m of summary.currentMedications) {
        lines.push(`- ${m.name}${m.strengthLabel ? ` (${m.strengthLabel})` : ""}`);
        if (m.ingredients.length) lines.push(`  ${m.ingredients.join(", ")}`);
        lines.push(`  ${m.instructionSummary}`);
        if (m.prescriberName) lines.push(`  Prescribed by ${m.prescriberName}`);
      }
    lines.push("");
  }

  if (summary.recentChanges) {
    lines.push(bold("Recent changes (last 90 days)"));
    if (summary.recentChanges.length === 0) lines.push("No changes in this period.");
    else
      for (const c of summary.recentChanges) {
        lines.push(`- ${c.medicationName} — ${c.change.replace(/_/g, " ")} (${formatDate(c.occurredAt)})`);
      }
    lines.push("");
  }

  if (summary.glucoseReadings) {
    const g = summary.glucoseReadings;
    lines.push(bold("Blood sugar (last 90 days)"));
    if (g.readingCount === 0) lines.push("No readings in this period.");
    else {
      lines.push(`${g.readingCount} readings · average ${g.averageMgDl} mg/dL · range ${g.lowestMgDl}–${g.highestMgDl}`);
      for (const c of g.byContext) {
        lines.push(`- ${contextLabel(c.context)}: average ${c.averageMgDl} mg/dL (${c.count})`);
      }
      if (g.recent.length) {
        lines.push("Most recent:");
        for (const r of g.recent) {
          lines.push(`- ${r.valueMgDl} mg/dL, ${contextLabel(r.context)} (${formatDate(r.measuredAt)})${r.note ? ` — ${r.note}` : ""}`);
        }
      }
    }
    lines.push("");
  }

  if (summary.bloodPressureReadings) {
    const bp = summary.bloodPressureReadings;
    lines.push(bold("Blood pressure (last 90 days)"));
    if (bp.readingCount === 0) lines.push("No readings in this period.");
    else {
      lines.push(`${bp.readingCount} readings · average ${bp.averageSystolic}/${bp.averageDiastolic} mmHg`);
      if (bp.recent.length) {
        lines.push("Most recent:");
        for (const r of bp.recent) {
          const pulse = r.pulseBpm != null ? `, pulse ${r.pulseBpm}` : "";
          lines.push(`- ${r.systolic}/${r.diastolic} mmHg${pulse} (${formatDate(r.measuredAt)})${r.note ? ` — ${r.note}` : ""}`);
        }
      }
    }
    lines.push("");
  }

  if (summary.weightReadings) {
    const w = summary.weightReadings;
    lines.push(bold("Body weight (last 90 days)"));
    if (w.readingCount === 0) lines.push("No readings in this period.");
    else {
      const change = w.changeKg != null ? ` · change ${Number(w.changeKg) > 0 ? "+" : ""}${w.changeKg} kg over the period` : "";
      lines.push(`${w.readingCount} readings · latest ${w.latestKg} kg${change}`);
      if (w.recent.length) {
        lines.push("Most recent:");
        for (const r of w.recent) {
          lines.push(`- ${r.weightKg} kg (${formatDate(r.measuredAt)})${r.note ? ` — ${r.note}` : ""}`);
        }
      }
    }
    lines.push("");
  }

  if (summary.checkups) {
    lines.push(bold("Check-ups (last 90 days)"));
    if (summary.checkups.length === 0) lines.push("No check-ups in this period.");
    else
      for (const c of summary.checkups) {
        lines.push(`- ${formatDateOnly(c.checkupDate)}`);
        // Only what was actually measured is listed — a metric the doctor
        // didn't record stays absent rather than showing as a zero or dash.
        for (const metric of checkupMetrics(c)) lines.push(`  ${metric}`);
        if (c.treatmentChanges) lines.push(`  Treatment changes: ${c.treatmentChanges}`);
        if (c.nextAppointmentDate) lines.push(`  Next appointment: ${formatDateOnly(c.nextAppointmentDate)}`);
      }
    lines.push("");
  }

  if (summary.prescriptions) {
    lines.push(bold("Prescriptions (last 90 days)"));
    if (summary.prescriptions.length === 0) lines.push("No prescriptions in this period.");
    else
      for (const p of summary.prescriptions) {
        const who = p.practitionerName ?? "Doctor not recorded";
        const when = p.prescribedAt ? formatDateOnly(p.prescribedAt) : "date not recorded";
        lines.push(`- ${who} (${when}) — ${p.medicationCount} medicine(s), ${p.documentCount} file(s)`);
        if (p.notes) lines.push(`  ${p.notes}`);
      }
    lines.push("");
  }

  if (summary.reports) {
    lines.push(bold("Test reports (last 90 days)"));
    if (summary.reports.length === 0) lines.push("No test reports in this period.");
    else
      for (const r of summary.reports) {
        const title = r.label ? `${reportKindLabel(r.kind)} — ${r.label}` : reportKindLabel(r.kind);
        const when = r.testedAt ? formatDateOnly(r.testedAt) : "date not recorded";
        lines.push(`- ${title} (${when})`);
        const where = [r.facilityName, r.practitionerName ? `ordered by ${r.practitionerName}` : null].filter(Boolean);
        if (where.length) lines.push(`  ${where.join(" · ")}`);
        for (const v of r.values ?? []) lines.push(`  ${reportValueLine(v)}`);
        if (r.notes) lines.push(`  ${r.notes}`);
        if (r.documentCount) lines.push(`  ${r.documentCount} file(s) on record`);
      }
    lines.push("");
  }

  if (summary.unresolvedConcerns) {
    lines.push(bold("Unresolved safety concerns"));
    if (summary.unresolvedConcerns.length === 0) lines.push("None open.");
    else {
      for (const c of summary.unresolvedConcerns) {
        lines.push(`- ${c.category.replace(/_/g, " ")} (${c.severity}) — ${c.summary}`);
      }
      lines.push("This may have been prescribed intentionally. Please confirm with a doctor or pharmacist before changing anything.");
    }
    lines.push("");
  }

  lines.push("Generated by medpass from the patient's own records. Not a prescription or medical advice.");
  return lines.join("\n").trim();
}
