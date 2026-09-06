/**
 * `@medpass/terminology` — versioned code tables + pure functions
 * (docs_v2/08 §3, Phase 0 ticket 0.28).
 *
 * No network, no Prisma, no dependency on apps/*. Everything here is
 * deterministic and snapshot-tested; Gate 1b reviews the tables via
 * `listUnmapped()` and the `gate1bReview` / `reviewNote` fields.
 */

import { ANALYTES_V1, type AnalyteEntry, type AnalyteKey } from "./analytes.v1.js";
import { DOCUMENT_TYPES_V1, type DocumentKindKey, type DocumentTypeEntry } from "./document-types.v1.js";
import {
  OBSERVATION_CONCEPTS_V1,
  type ObservationConceptEntry,
  type ObservationConceptKey,
} from "./observation-concepts.v1.js";

export const TERMINOLOGY_VERSION = "v1" as const;

export * from "./types.js";
export * from "./analytes.v1.js";
export * from "./observation-concepts.v1.js";
export * from "./document-types.v1.js";
export {
  convertUnit,
  toCanonicalUnit,
  listAllowedUnits,
  resolveUnitCode,
  normalizeUnitText,
  UnitConversionError,
  type UnitConversionErrorCode,
  type UnitBearingEntry,
} from "./units.js";

// --- Lookups -----------------------------------------------------------------

const analyteIndex: ReadonlyMap<string, AnalyteEntry> = new Map(ANALYTES_V1.map((a) => [a.key, a]));
const conceptIndex: ReadonlyMap<string, ObservationConceptEntry> = new Map(
  OBSERVATION_CONCEPTS_V1.map((c) => [c.key, c]),
);
const documentTypeIndex: ReadonlyMap<string, DocumentTypeEntry> = new Map(DOCUMENT_TYPES_V1.map((d) => [d.key, d]));

export function getAnalyte(key: AnalyteKey | string): AnalyteEntry | undefined {
  return analyteIndex.get(key);
}

export function listAnalytes(): readonly AnalyteEntry[] {
  return ANALYTES_V1;
}

export function getObservationConcept(key: ObservationConceptKey | string): ObservationConceptEntry | undefined {
  return conceptIndex.get(key);
}

export function listObservationConcepts(): readonly ObservationConceptEntry[] {
  return OBSERVATION_CONCEPTS_V1;
}

export function getDocumentType(kind: DocumentKindKey | string): DocumentTypeEntry | undefined {
  return documentTypeIndex.get(kind);
}

export function listDocumentTypes(): readonly DocumentTypeEntry[] {
  return DOCUMENT_TYPES_V1;
}

/** Find an analyte by its LOINC code (first match; codes are unique in the table). */
export function findAnalyteByLoinc(loincCode: string): AnalyteEntry | undefined {
  return ANALYTES_V1.find((a) => a.loincCode === loincCode);
}

// --- Gate 1b: unmapped entries ---------------------------------------------------

export type UnmappedKind = "analyte" | "observation_concept" | "document_type";

export interface UnmappedEntry {
  readonly kind: UnmappedKind;
  readonly key: string;
  readonly display: string;
  /**
   * True when the entry has no code *by design* (open `other` entries,
   * packaging photos, administrative documents). These need no review
   * decision; everything else on the list does.
   */
  readonly intentional: boolean;
  /** Also flagged by docs/34 as a named review item (analytes only). */
  readonly gate1bReview: boolean;
  readonly reviewNote: string | null;
}

/**
 * Every entry across all tables that lacks a primary LOINC code. This is the
 * Gate 1b worklist: the reviewer either supplies a code or confirms the entry
 * is intentionally uncoded.
 */
export function listUnmapped(): readonly UnmappedEntry[] {
  const out: UnmappedEntry[] = [];
  for (const a of ANALYTES_V1) {
    if (a.loincCode === null) {
      out.push({
        kind: "analyte",
        key: a.key,
        display: a.display,
        intentional: a.openEntry === true,
        gate1bReview: a.gate1bReview,
        reviewNote: a.reviewNote ?? null,
      });
    }
  }
  for (const c of OBSERVATION_CONCEPTS_V1) {
    if (c.loincCode === null) {
      out.push({
        kind: "observation_concept",
        key: c.key,
        display: c.display,
        intentional: c.openEntry === true,
        gate1bReview: false,
        reviewNote: c.reviewNote ?? null,
      });
    }
  }
  for (const d of DOCUMENT_TYPES_V1) {
    if (d.loincCode === null) {
      out.push({
        kind: "document_type",
        key: d.key,
        display: d.display,
        intentional: d.intentionallyUnmapped,
        gate1bReview: false,
        reviewNote: d.reviewNote ?? null,
      });
    }
  }
  return out;
}

/** Analytes docs/34 names for Gate 1b review, whether or not they carry a code. */
export function listGate1bReviewItems(): readonly AnalyteEntry[] {
  return ANALYTES_V1.filter((a) => a.gate1bReview);
}
