import type { DoseUnit } from "@medpass/domain";
import type { SlotDose } from "./frequency.js";

/**
 * Turns a dose into something a patient who can't read the instruction line
 * can still understand (docs/33 §"1-0-1 grid shown visually", docs/01 persona
 * P3 "icons with labels").
 *
 * Pure and unit-tested on purpose: the rules below decide what a *clinical
 * number* looks like, and docs/10 H-06 rates a fabricated dose as a
 * catastrophic hazard. Keeping them out of the React component means they can
 * be asserted directly rather than only through a screenshot.
 */

/**
 * Units where repeating a glyph tells the truth. Deliberately the same split
 * the add-medicine screen already makes — tablet/capsule get the ½/1/2 picker,
 * everything else gets a typed number — rather than a second, competing idea
 * of what "countable" means.
 *
 * Repeating a glyph five times for "5 ml" would draw a quantity that doesn't
 * exist: there is no such thing as five syrups.
 */
const COUNTABLE_UNITS: ReadonlySet<string> = new Set<DoseUnit>(["tablet", "capsule"]);

export function isCountableUnit(doseUnit: string): boolean {
  return COUNTABLE_UNITS.has(doseUnit);
}

export type DoseGlyphPlan =
  /** Draw `full` whole glyphs, plus a half glyph when `half` — e.g. 1½ tablets. */
  | { kind: "repeat"; full: number; half: boolean }
  /** Draw one glyph and state the number beside it — e.g. 5 ml, or 12 tablets. */
  | { kind: "single"; quantity: number };

/**
 * How many glyphs to draw for a dose.
 *
 * Falls back to a single glyph past `max` because a row of ten pills stops
 * being countable at a glance and starts being visual noise — the numeral is
 * clearer by then. Non-half fractions (0.25, 1.75) also fall back rather than
 * being rounded: a rounded dose is a wrong dose.
 */
export function planDoseGlyphs(quantity: number, doseUnit: string, max = 3): DoseGlyphPlan {
  if (!Number.isFinite(quantity) || quantity <= 0) return { kind: "single", quantity };
  if (!isCountableUnit(doseUnit)) return { kind: "single", quantity };
  // Only whole and half doses can be drawn honestly; the ½/1/2 picker is the
  // only fraction source the patient UI offers.
  const isHalfStep = Math.abs(quantity * 2 - Math.round(quantity * 2)) < 1e-9;
  if (!isHalfStep || quantity > max) return { kind: "single", quantity };
  const full = Math.floor(quantity);
  return { kind: "repeat", full, half: quantity - full >= 0.5 };
}

/**
 * Frequencies whose slots repeat *every day*, and are therefore safe to draw
 * as a standing time-of-day row.
 *
 * This is deliberately an allowlist rather than `proposeSlots(...) !== null`.
 * WEEKLY/FORTNIGHTLY/MONTHLY also return a morning slot, but only as a time
 * of day — that function's own comment notes the scheduler gets *which days*
 * from the medication's start date. A list tile has no such anchor, so
 * drawing a lone sun on a monthly injection would assert "every morning",
 * which is a false statement about a dose (docs/10 H-06).
 */
const DAILY_SLOT_FREQUENCIES: ReadonlySet<string> = new Set([
  "OD",
  "OD_AFTERNOON",
  "BD",
  "TDS",
  "HS",
  "PATTERN",
]);

export function hasFixedDailySlots(frequencyCode: string): boolean {
  return DAILY_SLOT_FREQUENCIES.has(frequencyCode);
}

/**
 * Statuses worth asking the patient about. Paused counts — it's meant to
 * resume, so its type still matters; stopped and completed are history.
 */
const TYPE_CONFIRMATION_STATUSES: ReadonlySet<string> = new Set(["current", "paused"]);

/**
 * Whether to ask the patient what kind of medicine this is (docs/07 screen 9).
 *
 * Scoped to medicines still in their life on purpose. A stopped or completed
 * one only ever shows its glyph on the "previous" tab, so asking buys
 * nothing — and including them left the prompt permanently unclearable for a
 * patient whose only remaining unconfirmed medicines were ones they'd already
 * stopped, which is exactly what happened to one of the pilot patients.
 */
export function needsDoseUnitConfirmation(status: string, doseUnitConfirmed: boolean): boolean {
  return !doseUnitConfirmed && TYPE_CONFIRMATION_STATUSES.has(status);
}

export interface SlotDoseAmount {
  slot: SlotDose["slot"];
  /** The actual amount taken in this slot, in dose units. */
  amount: number;
}

/**
 * The real per-slot dose. `proposeSlots` returns a *multiplier* per slot, not
 * an amount — `dailySlotQuantity`'s own docblock calls it that ("e.g. BD = 2")
 * — so BD with a dose of 2 means two tablets morning *and* two at night.
 */
export function perSlotDoses(doseQuantity: number, slots: SlotDose[]): SlotDoseAmount[] {
  return slots.map((s) => ({ slot: s.slot, amount: doseQuantity * s.quantity }));
}

/**
 * Whether every slot takes the same amount. When it doesn't (a pattern like
 * `2-0-1`), a single headline dose would misstate at least one of them, so the
 * caller must show the amounts per slot instead of one number.
 */
export function slotsAreUniform(amounts: SlotDoseAmount[]): boolean {
  if (amounts.length === 0) return true;
  const first = amounts[0]!.amount;
  return amounts.every((a) => Math.abs(a.amount - first) < 1e-9);
}

/**
 * Renders a dose amount for display: "½", "1½", "2", "0.75".
 * Halves get the real fraction character — far more legible at a glance than
 * "0.5", and it matches the ½ already shown in the add-medicine picker.
 */
export function formatDoseAmount(quantity: number): string {
  if (!Number.isFinite(quantity)) return String(quantity);
  const whole = Math.floor(quantity);
  const isHalf = Math.abs(quantity - whole - 0.5) < 1e-9;
  if (!isHalf) return String(Number(quantity.toFixed(2)));
  return whole === 0 ? "½" : `${whole}½`;
}
