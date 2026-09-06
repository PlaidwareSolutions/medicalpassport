/** docs_v2/08 section 6 #3 (`timing.repeat.when` from slots, text preserved) and #4 (status map, informationSource = Patient). */
import { describe, expect, it } from "vitest";
import {
  FREQUENCY_CODES,
  MEDICATION_STATEMENT_STATUS,
  MEDICATION_STATUSES,
  SUPPORTED_IG_VERSIONS,
  patternWhen,
  serialize,
  timingRepeatFor,
  validateResource,
  type CanonicalMedicationRequest,
  type CanonicalMedicationStatement,
  type MedicationRequestResource,
  type MedicationStatementResource,
} from "../../src/index.js";
import { clone, loadCanonical } from "../helpers.js";

describe("timing.repeat from frequency codes (#3)", () => {
  it.each([
    ["OD", ["MORN"]],
    ["OD_AFTERNOON", ["AFT"]],
    ["BD", ["MORN", "NIGHT"]],
    ["TDS", ["MORN", "AFT", "NIGHT"]],
    ["HS", ["HS"]],
  ] as const)("%s → when %j", (code, when) => {
    expect(timingRepeatFor(code, null)).toMatchObject({ frequency: when.length, period: 1, periodUnit: "d", when });
  });

  it("PATTERN derives slots from the 1-0-1 string and refuses malformed or all-zero patterns", () => {
    expect(timingRepeatFor("PATTERN", "1-0-1")).toMatchObject({ frequency: 2, when: ["MORN", "NIGHT"] });
    expect(timingRepeatFor("PATTERN", "0-1-0")).toMatchObject({ frequency: 1, when: ["AFT"] });
    expect(patternWhen("0-0-0")).toBeNull();
    expect(patternWhen("1-0")).toBeNull();
    expect(timingRepeatFor("PATTERN", null)).toBeNull();
  });

  it("codes needing patient setup get their period, never invented slots", () => {
    expect(timingRepeatFor("QID", null)).toEqual({ frequency: 4, period: 1, periodUnit: "d" });
    expect(timingRepeatFor("ALTERNATE_DAY", null)).toEqual({ frequency: 1, period: 2, periodUnit: "d" });
    expect(timingRepeatFor("WEEKLY", null)).toEqual({ frequency: 1, period: 1, periodUnit: "wk" });
    expect(timingRepeatFor("FORTNIGHTLY", null)).toEqual({ frequency: 1, period: 2, periodUnit: "wk" });
    expect(timingRepeatFor("MONTHLY", null)).toEqual({ frequency: 1, period: 1, periodUnit: "mo" });
    expect(timingRepeatFor("SOS", null)).toBeNull();
    expect(timingRepeatFor("CUSTOM", null)).toBeNull();
  });

  describe.each(SUPPORTED_IG_VERSIONS)("every frequency code validates on IG %s and keeps the original text", (version) => {
    it.each(FREQUENCY_CODES)("%s", (code) => {
      const canonical = clone(loadCanonical<CanonicalMedicationRequest>("medication-request-bd-after-food"));
      canonical.dosage = { ...canonical.dosage, frequencyCode: code, pattern: code === "PATTERN" ? "1-1-1" : null, text: `original ${code} text` };
      const { resource } = serialize({ kind: "MedicationRequest", canonical }, { ig: version });
      const dosage = (resource as MedicationRequestResource).dosageInstruction![0]!;
      expect(dosage.text).toBe(`original ${code} text`);
      expect(dosage.timing?.code?.coding?.[0]?.code).toBe(code);
      if (code === "SOS") expect(dosage.asNeededBoolean).toBe(true);
      expect(validateResource(resource, { ig: version })).toEqual({ ok: true });
    });
  });
});

describe("MedicationStatement status map and information source (#4)", () => {
  it("maps current→active, paused→on-hold, completed, stopped, unknown", () => {
    expect(MEDICATION_STATEMENT_STATUS).toEqual({ current: "active", paused: "on-hold", completed: "completed", stopped: "stopped", unknown: "unknown" });
  });

  describe.each(SUPPORTED_IG_VERSIONS)("IG %s", (version) => {
    it.each(MEDICATION_STATUSES)("status %s serializes, validates, and says the patient reported it", (status) => {
      const canonical = { ...clone(loadCanonical<CanonicalMedicationStatement>("medication-statement-current")), status };
      const { resource, provenance } = serialize({ kind: "MedicationStatement", canonical }, { ig: version });
      const statement = resource as MedicationStatementResource;
      expect(statement.status).toBe(MEDICATION_STATEMENT_STATUS[status]);
      expect(statement.informationSource).toEqual({ reference: `Patient/${canonical.patient.patientProfileId}` });
      expect(statement.category?.coding?.[0]?.code).toBe("patientspecified");
      expect(validateResource(resource, { ig: version })).toEqual({ ok: true });
      // Provenance says patient-reported: record source is user_entered, never a provider claim.
      expect(provenance.extension?.find((e) => e.url.endsWith("record-source"))?.valueCode).toBe("user_entered");
    });

    it("a PRN medicine without an instruction still gets an asNeeded dosage", () => {
      const { resource } = serialize({ kind: "MedicationStatement", canonical: loadCanonical("medication-statement-paused-prn") }, { ig: version });
      const statement = resource as MedicationStatementResource;
      expect(statement.dosage).toEqual([{ asNeededBoolean: true }]);
      expect(statement.medicationCodeableConcept).toEqual({ text: "Paracetamol 650" });
      expect(statement.effectivePeriod).toEqual({ start: "2026-07-01", end: "2026-07-20" });
    });
  });
});
