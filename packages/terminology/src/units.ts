/**
 * Unit conversion for analytes and observation concepts (docs_v2/04 §6.4):
 * "Cross-unit series are never merged silently; unit conversion is a
 * terminology-layer function with tests."
 *
 * Conversions are only ever performed *within one entry's* allowed-unit set
 * (canonical unit + `allowedEnteredUnits`). Because every allowed unit for
 * an entry is, by construction, the same physical quantity as the canonical
 * unit, the function can never convert across incompatible dimensions — a
 * unit outside the entry's set is an error, not a guess.
 */

import { ANALYTES_V1, type AnalyteKey } from "./analytes.v1.js";
import { OBSERVATION_CONCEPTS_V1, type ObservationConceptKey } from "./observation-concepts.v1.js";
import type { UnitConversion } from "./types.js";

export type UnitConversionErrorCode =
  | "unknown_key"
  | "no_canonical_unit"
  | "unsupported_unit"
  | "non_finite_value";

export class UnitConversionError extends Error {
  override readonly name = "UnitConversionError";
  constructor(
    readonly code: UnitConversionErrorCode,
    readonly key: string,
    readonly unit: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** Resolved conversion for one unit of one entry: canonical = value * factor + offset. */
interface ResolvedUnit {
  readonly unit: string;
  readonly display: string;
  readonly aliases: readonly string[];
  readonly factor: number;
  readonly offset: number;
  readonly isCanonical: boolean;
}

/**
 * Loose matching so `µmol/L`, `umol/L`, `umol/l` and `µMOL/L` all resolve to
 * the same entry. Normalisation is deliberately narrow: micro-sign variants,
 * whitespace, case. It never rewrites the unit itself.
 */
export function normalizeUnitText(unit: string): string {
  return unit
    .normalize("NFKC")
    .replace(/[µμ]/g, "u") // micro sign and Greek mu -> u
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** The subset of an analyte / concept entry the converter needs. */
export interface UnitBearingEntry {
  readonly key: string;
  readonly canonicalUnit: string | null;
  readonly canonicalUnitDisplay: string | null;
  readonly canonicalUnitAliases?: readonly string[];
  readonly allowedEnteredUnits: readonly UnitConversion[];
}

function findEntry(key: string): UnitBearingEntry | undefined {
  const analyte = (ANALYTES_V1 as readonly UnitBearingEntry[]).find((a) => a.key === key);
  if (analyte) return analyte;
  return (OBSERVATION_CONCEPTS_V1 as readonly UnitBearingEntry[]).find((c) => c.key === key);
}

function requireEntry(key: string): UnitBearingEntry {
  const entry = findEntry(key);
  if (!entry) {
    throw new UnitConversionError("unknown_key", key, null, `Unknown analyte or observation concept "${key}"`);
  }
  return entry;
}

function unitTable(entry: UnitBearingEntry): ResolvedUnit[] {
  if (entry.canonicalUnit === null || entry.canonicalUnitDisplay === null) return [];
  const table: ResolvedUnit[] = [
    {
      unit: entry.canonicalUnit,
      display: entry.canonicalUnitDisplay,
      aliases: entry.canonicalUnitAliases ?? [],
      factor: 1,
      offset: 0,
      isCanonical: true,
    },
  ];
  for (const u of entry.allowedEnteredUnits) {
    table.push({
      unit: u.unit,
      display: u.display,
      aliases: u.aliases ?? [],
      factor: u.factor,
      offset: u.offset ?? 0,
      isCanonical: false,
    });
  }
  return table;
}

function matches(resolved: ResolvedUnit, wanted: string): boolean {
  const n = normalizeUnitText(wanted);
  if (n === normalizeUnitText(resolved.unit) || n === normalizeUnitText(resolved.display)) return true;
  return resolved.aliases.some((a) => normalizeUnitText(a) === n);
}

function resolveUnit(entry: UnitBearingEntry, unit: string): ResolvedUnit {
  const table = unitTable(entry);
  if (table.length === 0) {
    throw new UnitConversionError(
      "no_canonical_unit",
      entry.key,
      unit,
      `"${entry.key}" has no canonical unit; its values are free text and cannot be converted`,
    );
  }
  const found = table.find((r) => matches(r, unit));
  if (!found) {
    const allowed = table.map((r) => r.display).join(", ");
    throw new UnitConversionError(
      "unsupported_unit",
      entry.key,
      unit,
      `Unit "${unit}" is not an allowed unit for "${entry.key}" (allowed: ${allowed})`,
    );
  }
  return found;
}

/**
 * The units accepted for `key` (canonical first). Useful for unit pickers and
 * for validating input before calling `convertUnit`.
 */
export function listAllowedUnits(
  key: AnalyteKey | ObservationConceptKey | string,
): readonly { unit: string; display: string; isCanonical: boolean }[] {
  return unitTable(requireEntry(key)).map(({ unit, display, isCanonical }) => ({ unit, display, isCanonical }));
}

/** Resolve a user-typed unit spelling to the UCUM code the tables use for it. */
export function resolveUnitCode(key: AnalyteKey | ObservationConceptKey | string, unit: string): string {
  return resolveUnit(requireEntry(key), unit).unit;
}

/**
 * Convert `value` from `fromUnit` to `toUnit` for the analyte or observation
 * concept identified by `analyteOrConceptKey`.
 *
 * Throws `UnitConversionError` when the key is unknown, the entry has no
 * canonical unit, or either unit is outside the entry's allowed set. It never
 * guesses: the only conversions it performs are the ones written into the
 * versioned tables, and those are all same-dimension by construction.
 */
export function convertUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
  analyteOrConceptKey: AnalyteKey | ObservationConceptKey | string,
): number {
  const key = analyteOrConceptKey;
  if (!Number.isFinite(value)) {
    throw new UnitConversionError("non_finite_value", key, fromUnit, `Cannot convert non-finite value ${String(value)}`);
  }
  const entry = requireEntry(key);
  const from = resolveUnit(entry, fromUnit);
  const to = resolveUnit(entry, toUnit);
  if (from.unit === to.unit) return value;

  const canonical = value * from.factor + from.offset;
  return (canonical - to.offset) / to.factor;
}

/** Convenience: bring a value entered in `enteredUnit` to the entry's canonical unit. */
export function toCanonicalUnit(
  value: number,
  enteredUnit: string,
  analyteOrConceptKey: AnalyteKey | ObservationConceptKey | string,
): { value: number; unit: string } {
  const entry = requireEntry(analyteOrConceptKey);
  if (entry.canonicalUnit === null) {
    throw new UnitConversionError("no_canonical_unit", entry.key, enteredUnit, `"${entry.key}" has no canonical unit`);
  }
  return { value: convertUnit(value, enteredUnit, entry.canonicalUnit, entry.key), unit: entry.canonicalUnit };
}
