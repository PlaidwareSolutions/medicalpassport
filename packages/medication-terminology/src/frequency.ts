import type { FrequencyCode } from "@medpass/domain";

export interface SlotDose {
  slot: "morning" | "midday" | "night";
  quantity: number;
}

/**
 * Interprets an Indian prescription frequency into per-slot doses.
 *
 * This is a *proposal* generator, never an authority: the UI must show the
 * detected code alongside this interpretation and require explicit patient
 * confirmation before anything is scheduled (docs/09, spec §6). Ambiguity
 * returns `null` rather than a guess.
 */
export function proposeSlots(code: FrequencyCode, pattern?: string): SlotDose[] | null {
  switch (code) {
    case "OD":
      return [{ slot: "morning", quantity: 1 }];
    case "BD":
      return [
        { slot: "morning", quantity: 1 },
        { slot: "night", quantity: 1 },
      ];
    case "TDS":
      return [
        { slot: "morning", quantity: 1 },
        { slot: "midday", quantity: 1 },
        { slot: "night", quantity: 1 },
      ];
    case "HS":
      return [{ slot: "night", quantity: 1 }];
    case "PATTERN":
      return pattern ? parsePattern(pattern) : null;
    // QID needs a fourth, patient-specific time; SOS is as-needed;
    // alternate-day/weekly/custom need dates. All require explicit setup.
    case "QID":
    case "SOS":
    case "ALTERNATE_DAY":
    case "WEEKLY":
    case "CUSTOM":
      return null;
  }
}

/** Parses "1-0-1"-style morning-noon-night patterns. Returns null when malformed. */
export function parsePattern(pattern: string): SlotDose[] | null {
  const m = pattern.trim().match(/^(\d(?:\.\d)?)-(\d(?:\.\d)?)-(\d(?:\.\d)?)$/);
  if (!m) return null;
  const [morning, midday, night] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ([morning, midday, night].some((n) => Number.isNaN(n) || n > 10)) return null;
  if (morning === 0 && midday === 0 && night === 0) return null;
  const slots: SlotDose[] = [];
  if (morning > 0) slots.push({ slot: "morning", quantity: morning });
  if (midday > 0) slots.push({ slot: "midday", quantity: midday });
  if (night > 0) slots.push({ slot: "night", quantity: night });
  return slots;
}

/** Localization keys for plain-language frequency descriptions. */
export function frequencyDescriptionKey(code: FrequencyCode): string {
  return `frequency.${code.toLowerCase()}`;
}

/** Total daily dose-unit multiplier across all slots (e.g. BD = 2) — used for refill-supply estimates (docs/07 screen 27). */
export function dailySlotQuantity(slots: SlotDose[]): number {
  return slots.reduce((sum, s) => sum + s.quantity, 0);
}
