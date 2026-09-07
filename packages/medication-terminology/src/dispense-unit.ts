import { DOSE_UNITS, type DoseUnit } from "@medpass/domain";

/**
 * A pharmacy counts what it hands over in its own words — "30 strip", "2
 * bottle", "10 tabs" — while the patient's supply counter
 * (`PatientMedication.quantityOnHand`) is denominated in the dose unit of
 * their confirmed instruction. Adding one number to the other moves the
 * projected run-out date the patient reads on their own screen (docs_v2/10
 * — the refill projection is patient-facing), so the two units have to name
 * the same thing before a dispense may touch the counter.
 *
 * This module deliberately knows nothing about pack sizes. "1 strip" is ten
 * tablets for one brand and fifteen for another; inventing a factor would
 * put a number in front of the patient that nobody actually counted. So the
 * rule is narrow: the same unit under a different spelling converts 1:1,
 * and everything else is refused and reported back to the pharmacy.
 */

/**
 * Spellings a pharmacist may type or pick for each dose unit. Only
 * synonyms — never a container ("strip", "bottle", "vial", "tube", "box"),
 * which names a pack whose contents this module cannot know.
 */
const SYNONYMS: Readonly<Record<DoseUnit, readonly string[]>> = {
  tablet: ["tablet", "tablets", "tab", "tabs", "tb", "pill", "pills"],
  capsule: ["capsule", "capsules", "cap", "caps"],
  ml: ["ml", "mls", "milliliter", "millilitre", "milliliters", "millilitres", "cc"],
  drop: ["drop", "drops", "gtt", "gtts"],
  puff: ["puff", "puffs", "inhalation", "inhalations", "actuation", "actuations"],
  sachet: ["sachet", "sachets", "packet", "packets", "pouch", "pouches"],
  unit: ["unit", "units", "iu", "u"],
  application: ["application", "applications", "app", "apps"],
};

const BY_SYNONYM: ReadonlyMap<string, DoseUnit> = new Map(
  DOSE_UNITS.flatMap((doseUnit) => SYNONYMS[doseUnit].map((spelling) => [spelling, doseUnit] as const)),
);

/** The dose unit a free-text unit names, or null when it names something else (a pack, a container, a typo). */
export function normalizeDispenseUnit(raw: string | null | undefined): DoseUnit | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/\./g, "");
  return BY_SYNONYM.get(cleaned) ?? null;
}

export type DispenseQuantityResult =
  | { ok: true; quantity: number; trackedUnit: DoseUnit | null }
  | { ok: false; reason: "unit_mismatch"; dispenseUnit: string; trackedUnit: DoseUnit };

/**
 * How much a dispense adds to the patient's supply counter.
 *
 * - `trackedUnit` null (the medicine has no confirmed instruction, so the
 *   counter is denominated in nothing in particular): there is no unit to
 *   contradict, and the quantity is taken as given.
 * - the units name the same dose unit: 1:1, whatever the spelling.
 * - anything else: refused, with both units named so the caller can say
 *   which two did not match.
 */
export function dispensedQuantityForSupply(input: {
  quantity: number;
  dispenseUnit: string;
  trackedUnit: string | null | undefined;
}): DispenseQuantityResult {
  const tracked = normalizeDispenseUnit(input.trackedUnit);
  if (!tracked) return { ok: true, quantity: input.quantity, trackedUnit: null };
  const dispensed = normalizeDispenseUnit(input.dispenseUnit);
  if (dispensed !== tracked) {
    return { ok: false, reason: "unit_mismatch", dispenseUnit: input.dispenseUnit.trim(), trackedUnit: tracked };
  }
  return { ok: true, quantity: input.quantity, trackedUnit: tracked };
}

/** The sentence the pharmacy is shown when the units do not match. Names both, and says what to do. */
export function unitMismatchMessage(dispenseUnit: string, trackedUnit: DoseUnit): string {
  return `The patient counts this medicine in ${trackedUnit}, not ${dispenseUnit.trim()}. Record the quantity in ${trackedUnit} so their supply stays right.`;
}
