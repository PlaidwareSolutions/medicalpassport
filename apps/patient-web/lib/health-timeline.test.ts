import { describe, expect, it } from "vitest";
import { t as translate, type MessageKey } from "@medpass/localization";
import { SUPPORTED_LOCALES } from "@medpass/domain";
import {
  eventHref,
  eventSentence,
  KIND_GROUP_KINDS,
  KIND_GROUPS,
  kindsForGroups,
  localDayKey,
  localTimeParts,
  showsTime,
  trustBadge,
  type HealthEventDto,
} from "./health-timeline";

const t = (key: MessageKey, params?: Record<string, string | number>) => translate("en", key, params);

function event(partial: Partial<HealthEventDto>): HealthEventDto {
  return {
    id: "e1",
    kind: "medicine_started",
    occurredAt: "2026-09-06T15:35:00.000Z",
    occurredAtLocal: "2026-09-06T21:05:00",
    entityType: "patient_medication",
    entityId: "m1",
    summary: {},
    encounterId: null,
    actorType: "patient",
    provenanceSource: "user_entered",
    verification: "patient_confirmed",
    supersededAt: null,
    ...partial,
  };
}

describe("trust badge (docs_v2/10 H-30)", () => {
  it("labels patient_confirmed as the patient's own word, never as verified", () => {
    const badge = trustBadge(event({ verification: "patient_confirmed" }));
    expect(badge?.key).toBe("health.trust.you_added");
    expect(badge?.tone).not.toBe("success");
  });

  it("attributes patient_confirmed to the caregiver by actor or by provenance", () => {
    expect(trustBadge(event({ verification: "patient_confirmed", actorType: "caregiver" }))?.key).toBe("health.trust.caregiver_added");
    expect(trustBadge(event({ verification: "patient_confirmed", provenanceSource: "caregiver_entered" }))?.key).toBe(
      "health.trust.caregiver_added",
    );
  });

  it("maps the other states from verification only", () => {
    expect(trustBadge(event({ verification: "unverified" }))?.key).toBe("health.trust.not_confirmed");
    expect(trustBadge(event({ verification: "provider_verified" }))?.key).toBe("health.trust.clinic_verified");
    expect(trustBadge(event({ verification: "source_authenticated" }))?.key).toBe("health.trust.from_source");
    expect(trustBadge(event({ verification: null }))).toBeNull();
  });

  it("no provenance source can promote a non-verified row to verified copy", () => {
    const sources = ["user_entered", "caregiver_entered", "ocr_extracted", "clinic_entered", "lab_imported", "abdm_imported", "system_derived"] as const;
    for (const provenanceSource of sources) {
      for (const verification of ["patient_confirmed", "unverified", null] as const) {
        const key = trustBadge(event({ verification, provenanceSource }))?.key;
        expect(key, `${provenanceSource}/${verification}`).not.toBe("health.trust.clinic_verified");
        expect(key, `${provenanceSource}/${verification}`).not.toBe("health.trust.from_source");
      }
    }
  });

  it("the 'verified' copy never contains the words that describe patient entry, in any locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const you = translate(locale, "health.trust.you_added");
      const verified = translate(locale, "health.trust.clinic_verified");
      expect(verified).not.toBe(you);
    }
  });
});

describe("event sentence", () => {
  it("builds one line per kind from summary, with fallbacks for missing optional parts", () => {
    expect(eventSentence(t, event({ kind: "prescription", summary: { practitionerName: "Dr. Rao", medicineCount: 3 } }))).toBe(
      "Prescription from Dr. Rao — 3 medicines",
    );
    expect(eventSentence(t, event({ kind: "prescription", summary: { medicineCount: 2 } }))).toBe("Prescription — 2 medicines");
    expect(eventSentence(t, event({ kind: "medicine_changed", summary: { name: "Metformin", detail: "dose 500 → 1000 mg" } }))).toBe(
      "Metformin was changed: dose 500 → 1000 mg",
    );
    expect(eventSentence(t, event({ kind: "medicine_changed", summary: { name: "Metformin", change: "updated", detail: { fields: ["instruction"] } } }))).toBe(
      "Metformin was changed",
    );
    expect(eventSentence(t, event({ kind: "measurement", summary: { concept: "blood_pressure", systolic: 130, diastolic: 85 } }))).toBe(
      "Blood pressure 130/85",
    );
    expect(eventSentence(t, event({ kind: "test_result", summary: { label: "HbA1c", facilityName: "Vijaya Diagnostics" } }))).toBe(
      "Test result: HbA1c · Vijaya Diagnostics",
    );
    expect(eventSentence(t, event({ kind: "doctor_visit", summary: { practitionerName: "Dr. Rao", organizationName: "Apollo", reasonText: "Fever" } }))).toBe(
      "Doctor visit · Dr. Rao, Apollo — Fever",
    );
    expect(eventSentence(t, event({ kind: "immunization", summary: { vaccine: "COVID-19", doseNumber: 2 } }))).toBe("Vaccination: COVID-19, dose 2");
  });

  it("never leaves an unfilled placeholder on screen", () => {
    for (const group of KIND_GROUPS) {
      for (const kind of KIND_GROUP_KINDS[group]) {
        const line = eventSentence(t, event({ kind, summary: {} }));
        expect(line, kind).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe("links and grouping", () => {
  it("links medicine events to the medicine detail, visits to the encounter, and clinical-profile events to their screens", () => {
    expect(eventHref(event({ kind: "medicine_stopped", summary: { medicationId: "m9" } }))).toBe("/medicines/m9");
    expect(eventHref(event({ kind: "prescription", entityType: "prescription", entityId: "p1" }))).toBe("/prescriptions/p1");
    expect(eventHref(event({ kind: "imaging_report", entityType: "medical_report", entityId: "r1" }))).toBe("/reports/r1");
    expect(eventHref(event({ kind: "doctor_visit", entityType: "encounter", entityId: "enc1" }))).toBe("/health/visits/enc1");
    expect(eventHref(event({ kind: "allergy_recorded", entityType: "patient_allergy", entityId: "a1" }))).toBe("/allergies");
    expect(eventHref(event({ kind: "share_created", entityType: "share", entityId: "s1" }))).toBeNull();
  });

  it("groups by the patient-local day and reads the patient-local time", () => {
    const e = event({ occurredAt: "2026-09-06T19:35:00.000Z", occurredAtLocal: "2026-09-07T01:05:00" });
    expect(localDayKey(e)).toBe("2026-09-07");
    expect(localTimeParts(e)).toEqual({ hour: 1, minute: 5 });
  });

  it("hides the server's noon placeholder on calendar-dated kinds but keeps real times", () => {
    expect(showsTime(event({ kind: "immunization", occurredAtLocal: "2024-03-01T12:00:00" }))).toBe(false);
    expect(showsTime(event({ kind: "medicine_changed", occurredAtLocal: "2026-09-06T12:00:00" }))).toBe(true);
    expect(showsTime(event({ kind: "prescription", occurredAtLocal: "2026-09-06T09:30:00" }))).toBe(true);
  });

  it("every kind group expands to distinct kinds and the union covers the filter chips", () => {
    const all = kindsForGroups(KIND_GROUPS);
    expect(new Set(all).size).toBe(all.length);
    expect(kindsForGroups(["tests"])).toEqual(["test_result", "imaging_report"]);
  });
});
