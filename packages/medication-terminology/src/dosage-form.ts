import type { DoseUnit } from "@medpass/domain";

/**
 * Proposes a default dose unit from a catalog product's dosage form name
 * (e.g. "syrup", "inhaler") — a *proposal* only, never an authority: the UI
 * must let the patient see and override it, same discipline as
 * `proposeSlots` for frequency. Unrecognized form names return `undefined`
 * rather than a guess.
 */
export function defaultDoseUnitForForm(formName: string | null | undefined): DoseUnit | undefined {
  if (!formName) return undefined;
  const normalized = formName.trim().toLowerCase();
  switch (normalized) {
    case "tablet":
      return "tablet";
    case "capsule":
      return "capsule";
    case "syrup":
    case "suspension":
    case "solution":
      return "ml";
    case "drops":
      return "drop";
    case "inhaler":
      return "puff";
    case "sachet":
    case "powder":
      return "sachet";
    case "cream":
    case "ointment":
    case "gel":
      return "application";
    case "injection":
      // Most injections are ml-dosed; insulin (unit-dosed) is the
      // exception and the patient can switch to "unit" themselves — a
      // default, not a decision.
      return "ml";
    default:
      return undefined;
  }
}
