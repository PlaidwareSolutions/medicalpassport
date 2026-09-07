import { describe, expect, it } from "vitest";
import { pluralKey, t, type MessageKey } from "@medpass/localization";
import { en } from "@medpass/localization/dist/dictionaries/en.js";
import { groupTokenForReading } from "./connections";
import { documentTitle, isAbdmImported, kindLabelKey } from "./documents";
import { timeZoneLabel } from "./patient-time";
import { findingStatusKey, isDismissedAsNotRelevant } from "./safety";
import type { SafetyFindingDto } from "@medpass/api-client";

/**
 * The patient-facing copy defects a production QA pass found, each pinned
 * to the rule it broke. Everything here is a pure helper — the screens that
 * use them are covered in e2e where a browser is the only witness.
 */

// ─── Item 2: machine pluralisation ────────────────────────────────────────

/** Every counted message that a call site pairs, as `[one, other]`. */
const COUNTED_PAIRS: Array<[MessageKey, MessageKey]> = [
  ["confirmtype.banner_title_one", "confirmtype.banner_title"],
  ["prescriptions.count_one", "prescriptions.count"],
  ["prescriptions.document_count_one", "prescriptions.document_count"],
  ["prescriptions.medication_count_one", "prescriptions.medication_count"],
  ["reports.document_count_one", "reports.document_count"],
  ["caregiver.pending_invitations_banner_one", "caregiver.pending_invitations_banner"],
  ["caregiver.pending_claim_invitations_banner_one", "caregiver.pending_claim_invitations_banner"],
  ["reminders.days_remaining_one", "reminders.days_remaining"],
  ["sync.pending_one", "sync.pending"],
  ["sync.conflicts_pending_one", "sync.conflicts_pending"],
  ["sync.pending_document_one", "sync.pending_document"],
  ["share.access_count_one", "share.access_count"],
  ["health.event.prescription_one", "health.event.prescription"],
  ["health.event.prescription_anon_one", "health.event.prescription_anon"],
  ["health.event.document_one", "health.event.document"],
  ["rx.lines_count_one", "rx.lines_count"],
  ["rx.for_days_one", "rx.for_days"],
  ["dx.result_count_one", "dx.result_count"],
  ["trend.chart_aria_one", "trend.chart_aria"],
  ["measure.chart_aria_one", "measure.chart_aria"],
  ["measure.n_readings_one", "measure.n_readings"],
  ["documents.pages_count_one", "documents.pages_count"],
  ["documents.pages_title_one", "documents.pages_title"],
  ["documents.upload_pages_one", "documents.upload_pages"],
  ["documents.file_rejected_one", "documents.file_rejected"],
  ["documents.share_received_one", "documents.share_received"],
  ["documents.value.days_one", "documents.value.days"],
  ["device.sync_created_one", "device.sync_created"],
  ["device.sync_duplicates_one", "device.sync_duplicates"],
  ["proposals.summary.prescription_one", "proposals.summary.prescription"],
  ["proposals.summary.report_one", "proposals.summary.report"],
  ["proposals.dispense_days_one", "proposals.dispense_days"],
  ["proposals.for_days_one", "proposals.for_days"],
  ["abha.care_context_count_one", "abha.care_context_count"],
  ["abha.bundle_entries_one", "abha.bundle_entries"],
  ["journey.window_count_one", "journey.window_count"],
  // Wired in the dictionary only: the four call sites are in
  // VisitSummarySections.tsx, owned by another engineer this week.
  ["visit.document_pages_one", "visit.document_pages"],
  ["visit.glucose_summary_one", "visit.glucose_summary"],
  ["visit.bp_summary_one", "visit.bp_summary"],
  ["visit.weight_summary_one", "visit.weight_summary"],
];

describe("counted messages (a patient never reads '1 prescription(s)')", () => {
  it("picks the singular only for exactly one", () => {
    const [one, other] = ["documents.pages_count_one", "documents.pages_count"] as const;
    expect(pluralKey(1, one, other)).toBe(one);
    expect(pluralKey(0, one, other)).toBe(other);
    expect(pluralKey(2, one, other)).toBe(other);
    // Zero takes the plural in all four locales — "0 files", never "0 file".
    expect(t("en", pluralKey(0, "documents.pages_count_one", "documents.pages_count"), { n: 0 })).toBe("0 pages");
  });

  it("has both halves of every pair in the English dictionary", () => {
    for (const [one, other] of COUNTED_PAIRS) {
      expect(en, `missing ${one}`).toHaveProperty(one);
      expect(en, `missing ${other}`).toHaveProperty(other);
    }
  });

  it("leaves no '(s)' anywhere a patient can read it", () => {
    const leaks = Object.entries(en).filter(([, v]) => /\(s\)|\(es\)|\(ies\)|\(ें\)|\(లు\)|\(یں\)/.test(v));
    expect(leaks.map(([k]) => k)).toEqual([]);
  });

  it("renders one and many differently, and substitutes the count in both", () => {
    for (const [one, other] of COUNTED_PAIRS) {
      const fill = { low: "-", high: "-", title: "-", created: 1, duplicates: 1 };
      const singular = t("en", one, { ...fill, count: 1, n: 1, pages: 1 });
      const plural = t("en", other, { ...fill, count: 4, n: 4, pages: 4 });
      expect(singular, one).not.toBe(plural);
      expect(singular, one).not.toMatch(/\{(count|n|pages)\}/);
      expect(plural, other).not.toMatch(/\{(count|n|pages)\}/);
    }
  });

  it("the singular says one, not 'pages' — the exact strings QA reported", () => {
    expect(t("en", "documents.pages_count_one", { n: 1 })).toBe("1 page");
    expect(t("en", "measure.n_readings_one", { count: 1 })).toBe("1 reading");
    expect(t("en", "prescriptions.count_one", { count: 1 })).toBe("1 prescription");
    expect(t("en", "prescriptions.medication_count_one", { count: 1 })).toBe("1 medicine");
    expect(t("en", "caregiver.pending_invitations_banner_one", { count: 1 })).toBe("1 caregiver invitation waiting for your response");
  });
});

// ─── Item 4: "This doesn't apply to me" is not a professional's review ────

function finding(partial: Partial<SafetyFindingDto>): SafetyFindingDto {
  return {
    id: "f1",
    category: "drug_allergy",
    severity: "moderate",
    medicationIds: [],
    ruleKey: "drug-allergy",
    ruleVersion: "1",
    sourceName: "patient-reported-allergy",
    explanationKey: "safety.explain.allergy",
    detail: null,
    status: "resolved",
    lastAction: null,
    evaluatedAt: "2026-09-06T00:00:00.000Z",
    ...partial,
  };
}

describe("a finding the patient waved away (docs_v2/06 P9-4)", () => {
  it("is told apart from one a professional resolved, though both are 'resolved'", () => {
    const dismissed = finding({ lastAction: "dismissed_not_relevant" });
    const resolved = finding({ lastAction: "resolved" });
    expect(dismissed.status).toBe(resolved.status);
    expect(isDismissedAsNotRelevant(dismissed)).toBe(true);
    expect(isDismissedAsNotRelevant(resolved)).toBe(false);
  });

  it("gets its own words instead of the 'Resolved' chip", () => {
    expect(findingStatusKey(finding({ lastAction: "dismissed_not_relevant" }))).toBe("safety.status.dismissed_not_relevant");
    expect(t("en", "safety.status.dismissed_not_relevant")).toBe("You said this doesn't apply to you");
    expect(t("en", "safety.status.dismissed_not_relevant")).not.toMatch(/resolved|reviewed/i);
    expect(t("en", "safety.dismissed_findings")).not.toMatch(/resolved|reviewed/i);
  });

  it("keeps the ordinary statuses exactly as they were", () => {
    expect(findingStatusKey(finding({ status: "resolved", lastAction: "resolved" }))).toBe("safety.status.resolved");
    expect(findingStatusKey(finding({ status: "acknowledged", lastAction: "acknowledged" }))).toBe("safety.status.acknowledged");
    expect(findingStatusKey(finding({ status: "open", lastAction: null }))).toBe("safety.status.open");
  });

  it("never reclassifies a still-open finding, whatever action was last recorded", () => {
    expect(isDismissedAsNotRelevant(finding({ status: "open", lastAction: "dismissed_not_relevant" }))).toBe(false);
  });
});

// ─── Item 3: English leaking into hi/te/ur ───────────────────────────────

describe("copy that was leaking English", () => {
  it("says what a safety check was made against, not the rule id", () => {
    expect(t("en", "safety.evidence", { source: t("en", "safety.source.internal-catalog-normalization") })).toBe("Checked against: this app's medicine list");
    for (const locale of ["en", "hi", "te", "ur"] as const) {
      expect(t(locale, "safety.evidence", { source: "x" })).not.toMatch(/rule v|\{version\}/);
      expect(t(locale, "safety.source.patient-reported-allergy")).not.toMatch(/patient-reported-allergy/);
    }
  });

  it("names a time zone rather than printing its IANA identifier", () => {
    const label = timeZoneLabel("Asia/Kolkata", "en");
    expect(label).not.toBe("Asia/Kolkata");
    expect(label).toMatch(/India/);
    // The deprecated alias is the same zone and must read the same way.
    expect(timeZoneLabel("Asia/Calcutta", "en")).toBe(label);
  });

  it("falls back to the identifier rather than inventing a zone", () => {
    expect(timeZoneLabel("Not/AZone", "en")).toBe("Not/AZone");
    expect(timeZoneLabel("", "en")).toBe("");
  });

  it("has a word for every device kind and dose unit a screen can meet", () => {
    for (const kind of ["browser", "android", "ios", "other"]) expect(en).toHaveProperty(`profile.device_kind.${kind}`);
    for (const unit of ["tablet", "capsule", "ml", "drop", "puff", "sachet", "unit", "application"]) {
      for (const locale of ["hi", "te", "ur"] as const) {
        // A draft translation is fine; the English word verbatim is not,
        // except for units that are the same symbol everywhere ("ml").
        if (unit !== "ml") expect(t(locale, `unit.${unit}` as MessageKey), `${locale} unit.${unit}`).not.toBe(t("en", `unit.${unit}` as MessageKey));
      }
    }
  });

  it("translates the analyte names the condition hub shows", () => {
    for (const key of ["hba1c", "fasting_glucose", "creatinine", "tsh", "hemoglobin"]) {
      expect(en).toHaveProperty(`analyte.${key}`);
      expect(t("hi", `analyte.${key}` as MessageKey), key).not.toBe(t("en", `analyte.${key}` as MessageKey));
    }
  });
});

// ─── Item 5: the app never tells a patient to buy medicine ───────────────

describe("notification kind labels (docs_v2/10)", () => {
  it("describes a supply running out instead of telling the patient to buy", () => {
    for (const locale of ["en", "hi", "te", "ur"] as const) {
      expect(t(locale, "notify.kind.refill"), locale).not.toMatch(/buy|खरीद|लाने|కొనే|خرید|لانے/);
    }
    expect(t("en", "notify.kind.refill")).toBe("A medicine is about to run out");
  });
});

// ─── Item 11: the clinic code's read-out fallback ────────────────────────

describe("the clinic code, read out loud", () => {
  // Built, not written: a 43-character literal here reads as a live
  // credential to the repository's secret scanner, and this is a stand-in
  // for one — the same length a real onboarding code is minted at.
  const token = Array.from({ length: 43 }, (_, i) => "abcdefghij"[i % 10]).join("");

  it("groups the token for reading without changing a character of it", () => {
    const groups = groupTokenForReading(token);
    expect(groups.join("")).toBe(token);
    expect(groups.every((g) => g.length <= 4)).toBe(true);
    expect(groups).toHaveLength(Math.ceil(token.length / 4));
  });

  it("handles a short or empty token without an empty trailing group", () => {
    expect(groupTokenForReading("ab")).toEqual(["ab"]);
    expect(groupTokenForReading("")).toEqual([]);
    expect(groupTokenForReading("abcdefgh")).toEqual(["abcd", "efgh"]);
  });

  it("tells the truth about which path is the real one", () => {
    expect(t("en", "connections.code_readable_label")).toMatch(/camera|type/i);
    expect(t("en", "connections.code_readable_hint")).toMatch(/square/i);
  });
});

// ─── Item 12: an ABDM-imported bundle ────────────────────────────────────

describe("a record a hospital sent through ABDM", () => {
  const bundle = { kind: "prescription", title: "ABDM Prescription (IG 6.5)", sourceChannel: "abdm" };
  const photo = { kind: "prescription", title: "Dr Rao, August", sourceChannel: "camera" };

  it("is titled in words, never with the importer's audit string", () => {
    const title = documentTitle(bundle, (k, p) => t("en", k, p));
    expect(title).toBe("Prescription from a hospital");
    expect(title).not.toMatch(/ABDM|IG /);
  });

  it("leaves a document the patient photographed with the title they gave it", () => {
    expect(documentTitle(photo, (k, p) => t("en", k, p))).toBe("Dr Rao, August");
    expect(isAbdmImported(photo)).toBe(false);
    expect(isAbdmImported(bundle)).toBe(true);
  });

  it("gives an unclassified bundle a plain title instead of 'Something else from a hospital'", () => {
    const other = { kind: "other", title: "ABDM HealthDocumentRecord (IG 6.5)", sourceChannel: "abdm" };
    expect(documentTitle(other, (k, p) => t("en", k, p))).toBe("Health record from a hospital");
  });

  it("falls back to the kind when a photographed document has no title", () => {
    expect(documentTitle({ ...photo, title: null }, (k, p) => t("en", k, p))).toBe(t("en", kindLabelKey("prescription")));
  });

  it("explains the missing photo as a fact, not as a failure to try again", () => {
    expect(t("en", "documents.abdm_no_pages")).not.toMatch(/right now|try again/i);
    expect(t("en", "documents.abdm_source")).toMatch(/ABDM/);
  });
});

// ─── Item 7: a document that was deleted ─────────────────────────────────

describe("a document that is no longer there", () => {
  it("says it was removed rather than offering a retry that cannot work", () => {
    expect(t("en", "documents.not_found_title")).not.toBe(t("en", "common.error_generic"));
    expect(t("en", "documents.not_found_body")).toMatch(/removed/i);
    expect(t("en", "documents.not_found_body")).not.toMatch(/try again/i);
  });
});
