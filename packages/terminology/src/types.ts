/**
 * Shared shapes for the versioned terminology tables (docs_v2/08 §3).
 *
 * Tables are plain TS constants (JSON-like, `as const`) so they can be
 * snapshot-tested and diffed at review time. Nothing here touches the
 * network, Prisma, or any app.
 */

export const LOINC_SYSTEM = "http://loinc.org" as const;
export const UCUM_SYSTEM = "http://unitsofmeasure.org" as const;

/**
 * One unit a user (or an OCR extraction) may enter for an entry, and how to
 * bring it to the entry's canonical unit:
 *
 *   canonical = entered * factor + offset
 *
 * Affine conversions (`offset != 0`) exist for temperature (°F → °C) and
 * HbA1c (IFCC mmol/mol → NGSP %). Every other conversion is a pure factor.
 */
export interface UnitConversion {
  /** UCUM code of the entered unit (e.g. `mmol/L`, `umol/L`, `[degF]`). */
  readonly unit: string;
  /** Human form as printed on Indian reports / device screens (e.g. `µmol/L`, `°F`). */
  readonly display: string;
  /** Extra spellings that resolve to this unit (matched after normalisation). */
  readonly aliases?: readonly string[];
  readonly factor: number;
  readonly offset?: number;
  readonly note?: string;
}

/** Plausibility bounds only — never a clinical threshold (docs_v2/04 §5.2). */
export interface PlausibilityRange {
  readonly min: number;
  readonly max: number;
}
