import type { DocumentKind as PrismaDocumentKind } from "@medpass/database";
import type { DocumentKind as IntelligenceKind } from "@medpass/document-intelligence";

/**
 * The classifier's vocabulary (docs_v2/09 §4) and the database's `DocumentKind`
 * enum are not the same list: the enum still carries V1's packaging kinds
 * (`strip`, `box`, `bottle`) and its own `lab_report` / `scan_report` spellings
 * alongside the V2 additions. These two functions are the only place that
 * difference is reconciled, so a mapping bug shows up in one file, not five.
 */

const TO_PRISMA: Readonly<Record<IntelligenceKind, PrismaDocumentKind>> = Object.freeze({
  prescription: "prescription",
  laboratory_report: "laboratory_report",
  imaging_report: "imaging_report",
  discharge_summary: "discharge_summary",
  consultation_note: "consultation_note",
  vaccination_record: "vaccination_record",
  referral: "referral",
  insurance: "insurance",
  invoice: "invoice",
  // The classifier has one packaging kind; the database kept V1's three. A
  // photo of a strip is the overwhelmingly common case, and the patient can
  // correct it to box/bottle in one tap.
  medicine_packaging: "strip",
  other: "other",
});

const TO_INTELLIGENCE: Readonly<Record<PrismaDocumentKind, IntelligenceKind>> = Object.freeze({
  prescription: "prescription",
  strip: "medicine_packaging",
  box: "medicine_packaging",
  bottle: "medicine_packaging",
  discharge_summary: "discharge_summary",
  lab_report: "laboratory_report",
  scan_report: "imaging_report",
  other: "other",
  laboratory_report: "laboratory_report",
  imaging_report: "imaging_report",
  consultation_note: "consultation_note",
  vaccination_record: "vaccination_record",
  referral: "referral",
  insurance: "insurance",
  invoice: "invoice",
  imaging_film: "imaging_report",
});

export function toPrismaDocumentKind(kind: IntelligenceKind): PrismaDocumentKind {
  return TO_PRISMA[kind] ?? "other";
}

export function toIntelligenceKind(kind: PrismaDocumentKind): IntelligenceKind {
  return TO_INTELLIGENCE[kind] ?? "other";
}
