/**
 * Before/after windowing (docs_v2/06 P10-2).
 *
 * What this file is allowed to produce: the patient's own numbers, grouped
 * into three named time windows around a medicine's start date, each window
 * stated literally so the screen can say "1 – 30 March" rather than "before".
 *
 * What it must never produce, and what the shape below therefore has no room
 * for: a difference, a percentage, a direction, a rating, a verdict, or any
 * field whose name implies the medicine caused the change. Two measurements
 * either side of a date are a coincidence in time and nothing more
 * (docs_v2/10 §1 — Observation class; exit gate M10). The arithmetic that
 * would turn them into a claim is deliberately absent from the server, not
 * merely hidden by the client: `describeWindow` returns count / average /
 * min / max, exactly the descriptive statistics the trend endpoints already
 * return, and nothing else.
 */

/** One measurement, already in the canonical unit for its concept/analyte. */
export interface DatedValue {
  at: Date;
  value: number;
  /** Diastolic, for blood pressure. Null for every single-number measure. */
  value2?: number | null;
}

export type BeforeAfterWindowKey = "baseline" | "day30" | "day90";

/**
 * Fixed, server-owned window definitions. `baseline` is the month up to and
 * including the start date; the follow-ups are ±15 days around day 30 and
 * day 90, which is what "roughly" means here and is stated in the response
 * so it is never left to the reader to guess.
 */
export interface WindowSpec {
  key: BeforeAfterWindowKey;
  /** Days relative to the medicine's start date, inclusive at both ends. */
  fromDay: number;
  toDay: number;
}

export const BEFORE_AFTER_WINDOWS: readonly WindowSpec[] = [
  { key: "baseline", fromDay: -30, toDay: 0 },
  { key: "day30", fromDay: 15, toDay: 45 },
  { key: "day90", fromDay: 75, toDay: 105 },
];

/** A window with fewer points than this is reported as empty rather than as a number. */
export const MIN_POINTS_PER_WINDOW = 1;

const DAY_MS = 86_400_000;

export interface BeforeAfterWindow extends WindowSpec {
  /** Absolute bounds, so the screen can print the actual dates. */
  from: string;
  to: string;
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  /** Diastolic twins — null for every measure that has one number. */
  average2: number | null;
  min2: number | null;
  max2: number | null;
}

export interface BeforeAfterView {
  startDate: string;
  windows: BeforeAfterWindow[];
  /**
   * True when the baseline window and at least one follow-up window each
   * hold `MIN_POINTS_PER_WINDOW` readings. False means "there is not enough
   * of the patient's own data to show anything" — never "no effect".
   */
  hasEnoughPoints: boolean;
  minimumPointsPerWindow: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Descriptive statistics only — the same five the trend endpoints return. */
function describeWindow(spec: WindowSpec, from: Date, to: Date, values: DatedValue[]): BeforeAfterWindow {
  const base = { ...spec, from: from.toISOString(), to: to.toISOString() };
  if (values.length < MIN_POINTS_PER_WINDOW) {
    return { ...base, count: values.length, average: null, min: null, max: null, average2: null, min2: null, max2: null };
  }
  const firsts = values.map((v) => v.value);
  const seconds = values.map((v) => v.value2).filter((v): v is number => v !== null && v !== undefined);
  return {
    ...base,
    count: values.length,
    average: round(firsts.reduce((a, b) => a + b, 0) / firsts.length),
    min: Math.min(...firsts),
    max: Math.max(...firsts),
    average2: seconds.length === 0 ? null : round(seconds.reduce((a, b) => a + b, 0) / seconds.length),
    min2: seconds.length === 0 ? null : Math.min(...seconds),
    max2: seconds.length === 0 ? null : Math.max(...seconds),
  };
}

/**
 * Buckets `values` into the three fixed windows around `startDate`.
 *
 * Boundaries are inclusive at both ends and the windows do not overlap, so a
 * reading belongs to at most one window; readings outside all three are
 * dropped rather than folded into the nearest one, which would quietly move
 * a number closer to the start date than it really was.
 */
export function buildBeforeAfter(startDate: Date, values: readonly DatedValue[]): BeforeAfterView {
  const anchor = startDate.getTime();
  const windows = BEFORE_AFTER_WINDOWS.map((spec) => {
    // toDay is inclusive: the window ends at the last instant of that day offset.
    const from = new Date(anchor + spec.fromDay * DAY_MS);
    const to = new Date(anchor + spec.toDay * DAY_MS + (DAY_MS - 1));
    const inWindow = values.filter((v) => v.at.getTime() >= from.getTime() && v.at.getTime() <= to.getTime());
    return describeWindow(spec, from, to, inWindow);
  });
  const baseline = windows.find((w) => w.key === "baseline");
  const followUps = windows.filter((w) => w.key !== "baseline");
  return {
    startDate: startDate.toISOString(),
    windows,
    hasEnoughPoints:
      (baseline?.count ?? 0) >= MIN_POINTS_PER_WINDOW && followUps.some((w) => w.count >= MIN_POINTS_PER_WINDOW),
    minimumPointsPerWindow: MIN_POINTS_PER_WINDOW,
  };
}
