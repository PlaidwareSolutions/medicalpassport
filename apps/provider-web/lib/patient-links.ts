import type { LinkSection, PatientLinkDto } from "./types";

/** The share vocabulary as a clinician reads it. One table, used by the list and the patient page. */
export const SECTION_LABELS: Record<LinkSection, string> = {
  medications: "Current medicines",
  allergies: "Allergies",
  conditions: "Conditions",
  recentChanges: "Recent changes",
  concerns: "Concerns",
  glucoseReadings: "Glucose diary",
  bloodPressureReadings: "Blood pressure",
  weightReadings: "Weight",
  checkups: "Check-ups",
  prescriptions: "Prescriptions",
  reports: "Latest results",
  measurements: "Home measurements",
  documents: "Documents",
  encounters: "Visits",
};

export function sectionLabels(sections: readonly LinkSection[]): string {
  return sections.map((s) => SECTION_LABELS[s] ?? s).join(", ");
}

export interface PatientLinkRow {
  link: PatientLinkDto;
  /** 1-based position among the links this organization holds for the same patient. */
  position: number;
  /** How many links this organization holds for that patient. 1 for the ordinary case. */
  total: number;
}

/**
 * A patient can show a fresh QR code to the same clinic a second time —
 * after the first link expires, or to widen what they share — and the
 * clinic then holds two open links for them. The list showed the same name
 * twice with nothing to tell the two apart, so a receptionist could not
 * know which one to open.
 *
 * Links are grouped by the label the list actually shows (that is what the
 * reader compares), newest first within a group, and a row in a group of
 * more than one carries its position. The rows themselves stay separate:
 * they are separate grants, revoked separately, and merging them would hide
 * that.
 */
export function groupPatientLinks(links: readonly PatientLinkDto[], labelOf: (link: PatientLinkDto) => string): PatientLinkRow[] {
  const counts = new Map<string, number>();
  for (const link of links) {
    const key = labelOf(link);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return links.map((link) => {
    const key = labelOf(link);
    const position = (seen.get(key) ?? 0) + 1;
    seen.set(key, position);
    return { link, position, total: counts.get(key) ?? 1 };
  });
}
