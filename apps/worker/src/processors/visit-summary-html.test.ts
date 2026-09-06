import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderVisitSummaryHtml, type VisitSummaryDto } from "./visit-summary-html";

/**
 * Two guards against the silent-drift hazard documented at the top of
 * visit-summary-html.ts:
 *
 * 1. The worker's `VisitSummaryDto` is a hand-copied mirror of the API's
 *    (apps/api/src/modules/sharing/visit-summary.service.ts). apps/api is
 *    not an importable package, so the interface is compared at the
 *    source level — both declarations are extracted, comments and
 *    whitespace stripped, and diffed member by member.
 * 2. A fully-populated fixture is rendered and every field the template
 *    reads is asserted present; removing any section changes the output,
 *    so a section that exists in the type but is ignored by the template
 *    also fails.
 */

const WORKER_SOURCE = resolve(__dirname, "visit-summary-html.ts");
const API_SOURCE = resolve(__dirname, "../../../api/src/modules/sharing/visit-summary.service.ts");

function extractInterface(source: string, name: string, file: string): string {
  const header = `export interface ${name} {`;
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`${header} not found in ${file}`);
  let depth = 0;
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + header.length, i);
    }
  }
  throw new Error(`unbalanced braces in ${name} (${file})`);
}

function stripComments(block: string): string {
  return block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Top-level members of an interface body, whitespace-normalised, e.g. `profile:{displayName:string;...}`. */
function members(body: string): string[] {
  const compact = stripComments(body)
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,<>|?()[\]])\s*/g, "$1")
    .trim();
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of compact) {
    if (ch === "{" || ch === "<" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === ";" && depth === 0) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function memberName(member: string): string {
  return member.split(/[?:]/)[0]!;
}

const workerMembers = members(extractInterface(readFileSync(WORKER_SOURCE, "utf8"), "VisitSummaryDto", WORKER_SOURCE));

describe("VisitSummaryDto drift against apps/api", () => {
  it("the worker's copy of the DTO matches the API's declaration member for member", () => {
    const apiMembers = members(extractInterface(readFileSync(API_SOURCE, "utf8"), "VisitSummaryDto", API_SOURCE));
    expect(apiMembers.length).toBeGreaterThan(5);
    expect(workerMembers).toEqual(apiMembers);
  });
});

// ---------------------------------------------------------------------------
// Fixture: every section present and populated, plus one entry per optional
// sub-field so every branch of the template is exercised.

const fixture: Required<VisitSummaryDto> = {
  profile: { displayName: "Meera Krishnan", yearOfBirth: 1961, sex: "female", timezone: "Asia/Kolkata" },
  generatedAt: "2026-09-06T04:30:00.000Z",
  allergies: [
    { label: "Penicillin", severity: "severe", reactionNote: "anaphylaxis in 2010" },
    { label: "Dust mites", severity: "mild", reactionNote: null },
  ],
  conditions: [
    { label: "Type 2 diabetes", note: "diagnosed 2015" },
    { label: "Hypertension", note: null },
  ],
  currentMedications: [
    {
      name: "Glycomet",
      ingredients: ["Metformin", "Glimepiride"],
      strengthLabel: "500 mg / 1 mg",
      instructionSummary: "1 tablet morning and night, after food",
      prescriberName: "Dr. Anand Rao",
      startDate: "2026-06-01",
    },
    { name: "Amlong", ingredients: ["Amlodipine"], strengthLabel: null, instructionSummary: "1 tablet at night", prescriberName: null, startDate: null },
  ],
  recentChanges: [{ medicationName: "Glycomet", change: "dose_increased", occurredAt: "2026-08-20T09:00:00.000Z" }],
  unresolvedConcerns: [{ category: "drug_interaction", severity: "moderate", summary: "Metformin with contrast dye planned next week" }],
  glucoseReadings: {
    readingCount: 12,
    averageMgDl: 141,
    lowestMgDl: 78,
    highestMgDl: 212,
    byContext: [
      { context: "before_breakfast", count: 7, averageMgDl: 118 },
      { context: "after_dinner", count: 5, averageMgDl: 173 },
    ],
    recent: [
      { valueMgDl: 212, context: "after_dinner", measuredAt: "2026-09-05T15:30:00.000Z", note: "big dinner" },
      { valueMgDl: 96, context: "before_breakfast", measuredAt: "2026-09-05T01:30:00.000Z", note: null },
    ],
  },
  bloodPressureReadings: {
    readingCount: 8,
    averageSystolic: 128,
    averageDiastolic: 82,
    recent: [
      { systolic: 132, diastolic: 84, pulseBpm: 76, measuredAt: "2026-09-04T02:00:00.000Z", note: "after walk" },
      { systolic: 124, diastolic: 80, pulseBpm: null, measuredAt: "2026-09-03T02:00:00.000Z", note: null },
    ],
  },
  weightReadings: {
    readingCount: 5,
    latestKg: "72.4",
    changeKg: "1.2",
    recent: [{ weightKg: "72.4", measuredAt: "2026-09-01T02:00:00.000Z", note: "morning, fasting" }],
  },
  checkups: [
    {
      checkupDate: "2026-08-12",
      fastingGlucoseMgDl: 110,
      postPrandialGlucoseMgDl: 165,
      hba1cPercent: "6.8",
      bloodPressureSystolic: 130,
      bloodPressureDiastolic: 85,
      weightKg: "73.0",
      waistCircumferenceCm: "92",
      cholesterolMgDl: 190,
      treatmentChanges: "Increased metformin to 1000 mg",
      nextAppointmentDate: "2026-11-12",
    },
    {
      checkupDate: "2026-07-01",
      fastingGlucoseMgDl: null,
      postPrandialGlucoseMgDl: null,
      hba1cPercent: null,
      bloodPressureSystolic: null,
      bloodPressureDiastolic: null,
      weightKg: null,
      waistCircumferenceCm: null,
      cholesterolMgDl: null,
      treatmentChanges: null,
      nextAppointmentDate: null,
    },
  ],
  prescriptions: [
    { prescribedAt: "2026-08-12", practitionerName: "Dr. Anand Rao", notes: "Review in 3 months", documentCount: 1, medicationCount: 2 },
    { prescribedAt: null, practitionerName: null, notes: null, documentCount: 0, medicationCount: 1 },
  ],
  reports: [
    {
      kind: "blood_test",
      label: "Quarterly diabetes panel",
      facilityName: "Apollo Diagnostics",
      practitionerName: "Dr. Anand Rao",
      testedAt: "2026-08-10",
      notes: "Fasting sample",
      documentCount: 2,
      values: [
        { label: "HbA1c", enteredValue: "6.8", unit: "%", referenceText: "4.0–5.6" },
        { label: "Fasting glucose", enteredValue: "110", unit: "mg/dL", referenceText: null },
      ],
    },
    { kind: "imaging", label: null, facilityName: null, practitionerName: null, testedAt: null, notes: null, documentCount: 0 },
  ],
  measurements: [
    {
      concept: "blood_pressure",
      label: "Blood pressure",
      unit: "mmHg",
      count: 6,
      latest: { value: "128", value2: "82", measuredAt: "2026-09-05T02:00:00.000Z", context: "morning" },
      minimum: "118",
      maximum: "140",
      average: "127.5",
      average2: "81",
    },
    { concept: "body_weight", label: "Body weight", unit: "kg", count: 1, latest: { value: "72.4", value2: null, measuredAt: "2026-09-01T02:00:00.000Z", context: null }, minimum: "72.4", maximum: "72.4", average: "72.4", average2: null },
    { concept: "other", label: "Other", unit: "", count: 1, latest: null, minimum: null, maximum: null, average: null, average2: null },
  ],
  documents: [
    { id: "3f1c2b4e-9a7d-4c3e-8b21-0d5e6f7a8b9c", kind: "prescription", title: "Dr Sharma visit", documentDate: "2026-08-12", pageCount: 2, uploadedAt: "2026-08-12T10:00:00.000Z" },
    { id: "5a6b7c8d-1e2f-4a3b-9c4d-5e6f7a8b9c0d", kind: "lab_report", title: null, documentDate: null, pageCount: 1, uploadedAt: "2026-08-20T10:00:00.000Z" },
  ],
  encounters: [
    { kind: "outpatient", startedAt: "2026-08-12T09:00:00.000Z", endedAt: null, organizationName: "City Clinic", practitionerName: "Dr. Anand Rao", reasonText: "Quarterly review", diagnosisText: "Type 2 diabetes, controlled" },
    { kind: "lab_visit", startedAt: "2026-08-10T04:00:00.000Z", endedAt: "2026-08-10T04:30:00.000Z", organizationName: null, practitionerName: null, reasonText: null, diagnosisText: null },
  ],
};

const OPTIONAL_SECTIONS = workerMembers.filter((m) => m.includes("?")).map(memberName) as Array<keyof VisitSummaryDto>;

describe("renderVisitSummaryHtml — fixture coverage", () => {
  const html = renderVisitSummaryHtml(fixture);

  it("the fixture populates every member of the DTO (fails when a section is added to the type but not here)", () => {
    expect(Object.keys(fixture).sort()).toEqual(workerMembers.map(memberName).sort());
    for (const key of Object.keys(fixture) as Array<keyof VisitSummaryDto>) {
      const value = fixture[key];
      expect(value, key).toBeDefined();
      if (Array.isArray(value)) expect(value.length, `${key} must have entries`).toBeGreaterThan(0);
    }
  });

  it("renders every section heading", () => {
    for (const heading of [
      "Allergies",
      "Conditions",
      "Current medicines",
      "Recent changes (last 90 days)",
      "Blood sugar (last 90 days)",
      "Blood pressure (last 90 days)",
      "Body weight (last 90 days)",
      "Check-ups (last 90 days)",
      "Prescriptions (last 90 days)",
      "Test reports (last 90 days)",
      "Home measurements (last 30 days)",
      "Visits (last 90 days)",
      "Documents on record",
      "Unresolved safety concerns",
    ]) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
  });

  it("renders measurements: latest with both components, count, range, average; dashes when nothing numeric", () => {
    expect(html).toContain("<td>Blood pressure</td><td><strong>128/82 mmHg</strong>");
    expect(html).toContain(", morning)</span></td><td>6</td><td>118–140</td><td>127.5/81</td>");
    expect(html).toContain("<td>Body weight</td><td><strong>72.4 kg</strong>");
    expect(html).toContain("<td>Other</td><td>—</td><td>1</td><td>—</td><td>—</td>");
  });

  it("renders encounters with kind, date, where/who, reason and diagnosis; sparse ones plainly", () => {
    expect(html).toContain("<strong>outpatient</strong>");
    expect(html).toContain("— City Clinic · Dr. Anand Rao<br>Reason: Quarterly review<br>Diagnosis: Type 2 diabetes, controlled");
    expect(html).toContain("<strong>lab visit</strong>");
    expect(html).not.toContain("lab_visit");
  });

  it("renders documents as title/date/page count only — never the id", () => {
    expect(html).toContain("<strong>Dr Sharma visit</strong> <span class=\"muted\">(12 Aug 2026)</span> — 2 page(s)");
    expect(html).toContain("<strong>lab report</strong> <span class=\"muted\">(uploaded ");
    expect(html).not.toContain("3f1c2b4e");
  });

  it("every optional section is actually read by the template (removing it changes the output)", () => {
    expect(OPTIONAL_SECTIONS.length).toBeGreaterThan(5);
    for (const key of OPTIONAL_SECTIONS) {
      const without = { ...fixture } as VisitSummaryDto;
      delete without[key];
      expect(renderVisitSummaryHtml(without), `section ${key} is ignored by the renderer`).not.toBe(html);
    }
  });

  it("renders the profile header and generation stamp", () => {
    expect(html).toContain("<h1>Meera Krishnan</h1>");
    expect(html).toContain("Born 1961");
    expect(html).toContain("female ·");
    expect(html).toMatch(/Generated .*2026/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<footer>");
  });

  it("renders allergies with severity and optional reaction note", () => {
    expect(html).toContain("<strong>Penicillin</strong> — severe (anaphylaxis in 2010)");
    expect(html).toContain("<strong>Dust mites</strong> — mild</li>");
  });

  it("renders conditions with optional note", () => {
    expect(html).toContain("<strong>Type 2 diabetes</strong> — diagnosed 2015");
    expect(html).toContain("<strong>Hypertension</strong></li>");
  });

  it("renders current medicines: name, strength, ingredients, dosing, prescriber, start date", () => {
    expect(html).toContain("<td>Glycomet (500 mg / 1 mg)</td><td>Metformin, Glimepiride</td><td>1 tablet morning and night, after food</td><td>Dr. Anand Rao</td><td>2026-06-01</td>");
    expect(html).toContain("<td>Amlong</td><td>Amlodipine</td><td>1 tablet at night</td><td>—</td><td>—</td>");
  });

  it("renders recent changes with the change code humanised", () => {
    expect(html).toContain("Glycomet — dose increased");
    expect(html).not.toContain("dose_increased");
  });

  it("renders glucose aggregates, per-context breakdown and recent readings with human labels", () => {
    expect(html).toContain("<strong>12 readings</strong> · average 141 mg/dL · range 78–212");
    expect(html).toContain("<td>Before breakfast</td><td>7</td><td>118 mg/dL</td>");
    expect(html).toContain("<td>After dinner</td><td>5</td><td>173 mg/dL</td>");
    expect(html).toContain("<strong>212 mg/dL</strong> — After dinner");
    expect(html).toContain("— big dinner");
    expect(html).toContain("<strong>96 mg/dL</strong> — Before breakfast");
    expect(html).not.toContain("before_breakfast");
  });

  it("renders blood pressure aggregate and recent readings with optional pulse/note", () => {
    expect(html).toContain("<strong>8 readings</strong> · average 128/82 mmHg");
    expect(html).toContain("<strong>132/84 mmHg</strong> — pulse 76");
    expect(html).toContain("— after walk");
    expect(html).toContain("<strong>124/80 mmHg</strong> <span");
  });

  it("renders weight aggregate with signed change and recent readings", () => {
    expect(html).toContain("<strong>5 readings</strong> · latest 72.4 kg · change +1.2 kg over the period");
    expect(html).toContain("<strong>72.4 kg</strong>");
    expect(html).toContain("— morning, fasting");
  });

  it("renders a negative weight change without a plus sign", () => {
    const out = renderVisitSummaryHtml({ ...fixture, weightReadings: { ...fixture.weightReadings, changeKg: "-0.8" } });
    expect(out).toContain("change -0.8 kg");
    expect(out).not.toContain("+-0.8");
  });

  it("renders check-ups: every recorded metric, treatment changes, next appointment; unrecorded left out", () => {
    expect(html).toContain("12 Aug 2026");
    expect(html).toContain("Fasting glucose: 110 mg/dL");
    expect(html).toContain("Post-meal glucose: 165 mg/dL");
    expect(html).toContain("HbA1c: 6.8%");
    expect(html).toContain("Blood pressure: 130/85");
    expect(html).toContain("Weight: 73.0 kg");
    expect(html).toContain("Waist: 92 cm");
    expect(html).toContain("Cholesterol: 190 mg/dL");
    expect(html).toContain("<td>Increased metformin to 1000 mg</td><td>12 Nov 2026</td>");
    // The empty check-up shows "Not recorded" and dashes, never zeros.
    expect(html).toContain('<td><span class="muted">Not recorded</span></td><td>—</td><td>—</td>');
    expect(html).not.toContain("Fasting glucose: 0");
  });

  it("renders prescriptions metadata: practitioner, date, counts, notes; fallbacks when missing", () => {
    expect(html).toContain("<strong>Dr. Anand Rao</strong> <span class=\"muted\">(12 Aug 2026)</span> — 2 medicine(s), 1 file(s)<br>Review in 3 months");
    expect(html).toContain("<strong>Doctor not recorded</strong> <span class=\"muted\">(date not recorded)</span> — 1 medicine(s), 0 file(s)</li>");
  });

  it("renders reports metadata: kind label, label, facility, ordering practitioner, date, values, notes, file count", () => {
    expect(html).toContain("<strong>Blood test</strong><br>Quarterly diabetes panel");
    expect(html).toContain("10 Aug 2026");
    expect(html).toContain("Apollo Diagnostics<br>Ordered by Dr. Anand Rao");
    expect(html).toContain('HbA1c: 6.8 % <span class="muted">(ref 4.0–5.6)</span>');
    expect(html).toContain("Fasting glucose: 110 mg/dL");
    expect(html).toContain("<br>Fasting sample</td><td>2</td>");
    expect(html).not.toContain("blood_test");
    // Sparse report: humanised kind, dashes for missing cells, no "0 files".
    expect(html).toContain('<strong>Imaging / scan</strong></td><td><span class="muted">Not recorded</span></td><td>—</td><td>—</td><td>—</td>');
  });

  it("renders unresolved concerns with the humanised category and the safety disclaimer", () => {
    expect(html).toContain("<strong>drug interaction</strong> (moderate) — Metformin with contrast dye planned next week");
    expect(html).toContain("This may have been prescribed intentionally.");
  });
});

describe("renderVisitSummaryHtml — nothing internal leaks", () => {
  it("contains no ids, links, download URLs or storage keys", () => {
    const html = renderVisitSummaryHtml(fixture);
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<a\b|href=|<script|<img|<link/);
    expect(html).not.toMatch(/documentId|objectKey|storedObject|patientProfileId|\/download/);
  });

  it("escapes patient-entered text in every section", () => {
    const hostile = `<script>alert("x")</script> & 'quotes'`;
    const out = renderVisitSummaryHtml({
      ...fixture,
      profile: { ...fixture.profile, displayName: hostile },
      allergies: [{ label: hostile, severity: hostile, reactionNote: hostile }],
      conditions: [{ label: hostile, note: hostile }],
      currentMedications: [{ name: hostile, ingredients: [hostile], strengthLabel: hostile, instructionSummary: hostile, prescriberName: hostile, startDate: hostile }],
      recentChanges: [{ medicationName: hostile, change: hostile, occurredAt: fixture.generatedAt }],
      unresolvedConcerns: [{ category: hostile, severity: hostile, summary: hostile }],
      glucoseReadings: { ...fixture.glucoseReadings, byContext: [{ context: hostile, count: 1, averageMgDl: 1 }], recent: [{ valueMgDl: 1, context: hostile, measuredAt: fixture.generatedAt, note: hostile }] },
      bloodPressureReadings: { ...fixture.bloodPressureReadings, recent: [{ systolic: 1, diastolic: 1, pulseBpm: null, measuredAt: fixture.generatedAt, note: hostile }] },
      weightReadings: { ...fixture.weightReadings, latestKg: hostile, changeKg: hostile, recent: [{ weightKg: hostile, measuredAt: fixture.generatedAt, note: hostile }] },
      checkups: [{ ...fixture.checkups[0]!, hba1cPercent: hostile, weightKg: hostile, waistCircumferenceCm: hostile, treatmentChanges: hostile }],
      prescriptions: [{ ...fixture.prescriptions[0]!, practitionerName: hostile, notes: hostile }],
      reports: [{ ...fixture.reports[0]!, kind: hostile, label: hostile, facilityName: hostile, practitionerName: hostile, notes: hostile, values: [{ label: hostile, enteredValue: hostile, unit: hostile, referenceText: hostile }] }],
      measurements: [{ ...fixture.measurements[0]!, label: hostile, unit: hostile, latest: { value: hostile, value2: hostile, measuredAt: fixture.generatedAt, context: hostile }, minimum: hostile, maximum: hostile, average: hostile, average2: hostile }],
      documents: [{ ...fixture.documents[0]!, kind: hostile, title: hostile }],
      encounters: [{ ...fixture.encounters[0]!, kind: hostile, organizationName: hostile, practitionerName: hostile, reasonText: hostile, diagnosisText: hostile }],
    });
    expect(out).not.toContain("<script>");
    expect(out).not.toContain('alert("x")');
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;");
  });
});

describe("renderVisitSummaryHtml — empty and omitted sections", () => {
  it("renders an explicit empty state for a section that is present but empty", () => {
    const out = renderVisitSummaryHtml({
      profile: fixture.profile,
      generatedAt: fixture.generatedAt,
      allergies: [],
      conditions: [],
      currentMedications: [],
      recentChanges: [],
      unresolvedConcerns: [],
      glucoseReadings: { readingCount: 0, averageMgDl: null, lowestMgDl: null, highestMgDl: null, byContext: [], recent: [] },
      bloodPressureReadings: { readingCount: 0, averageSystolic: null, averageDiastolic: null, recent: [] },
      weightReadings: { readingCount: 0, latestKg: null, changeKg: null, recent: [] },
      checkups: [],
      prescriptions: [],
      reports: [],
      measurements: [],
      documents: [],
      encounters: [],
    });
    expect(out).toContain("No measurements in this period.");
    expect(out).toContain("No visits in this period.");
    expect(out).toContain("No documents.");
    expect(out.match(/None recorded\./g)).toHaveLength(2);
    expect(out).toContain("No current medicines recorded.");
    expect(out).toContain("No changes in this period.");
    expect(out.match(/No readings in this period\./g)).toHaveLength(3);
    expect(out).toContain("No check-ups in this period.");
    expect(out).toContain("No prescriptions in this period.");
    expect(out).toContain("No test reports in this period.");
    expect(out).toContain("None open.");
    expect(out).not.toContain("null");
  });

  it("omits a section entirely when the payload does not include it (share scoping)", () => {
    const out = renderVisitSummaryHtml({ profile: fixture.profile, generatedAt: fixture.generatedAt, allergies: fixture.allergies });
    expect(out).toContain("<h2>Allergies</h2>");
    expect(out).not.toContain("<section><h2>Conditions</h2>");
    expect(out).not.toContain("Current medicines");
    expect(out).not.toContain("Test reports");
    expect(out.match(/<section>/g)).toHaveLength(1);
  });

  it("omits year of birth and sex from the header when unknown", () => {
    const out = renderVisitSummaryHtml({ profile: { displayName: "A", yearOfBirth: null, sex: null, timezone: "UTC" }, generatedAt: fixture.generatedAt });
    expect(out).not.toContain("Born");
    expect(out).toMatch(/<div class="meta">\s*Generated /);
  });
});
