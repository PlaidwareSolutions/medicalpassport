import { BEFORE_AFTER_WINDOWS, MIN_POINTS_PER_WINDOW, buildBeforeAfter, type DatedValue } from "./before-after";

/**
 * Windowing unit tests (docs_v2/06 P10-2). The last case is the one that
 * matters most: the shape must stay descriptive. If someone ever adds a
 * `change`, `improvement` or `percentChange` field, this file fails before a
 * screen can render the claim.
 */
const START = new Date("2026-03-01T00:00:00.000Z");
const DAY = 86_400_000;

function at(offsetDays: number, value: number, value2?: number): DatedValue {
  return { at: new Date(START.getTime() + offsetDays * DAY), value, ...(value2 === undefined ? {} : { value2 }) };
}

function windowOf(view: ReturnType<typeof buildBeforeAfter>, key: string) {
  return view.windows.find((w) => w.key === key)!;
}

describe("before/after windowing", () => {
  it("uses the three fixed windows and reports their absolute bounds", () => {
    const view = buildBeforeAfter(START, []);
    expect(view.windows.map((w) => w.key)).toEqual(["baseline", "day30", "day90"]);
    expect(view.windows.map((w) => [w.fromDay, w.toDay])).toEqual(BEFORE_AFTER_WINDOWS.map((w) => [w.fromDay, w.toDay]));
    expect(windowOf(view, "baseline").from).toBe(new Date(START.getTime() - 30 * DAY).toISOString());
    // The end of a window is the last instant of that day offset, not its midnight.
    expect(windowOf(view, "day90").to).toBe(new Date(START.getTime() + 105 * DAY + (DAY - 1)).toISOString());
  });

  it("buckets readings into the window they fall in and leaves the rest out", () => {
    const view = buildBeforeAfter(START, [
      at(-40, 999), // before the baseline window — dropped, never pulled forward
      at(-20, 150),
      at(-2, 152),
      at(5, 148), // between baseline and day30 — belongs to neither
      at(30, 138),
      at(44, 136),
      at(60, 134), // between day30 and day90
      at(90, 131),
      at(200, 1), // long after — dropped
    ]);
    expect(windowOf(view, "baseline").count).toBe(2);
    expect(windowOf(view, "baseline").average).toBe(151);
    expect(windowOf(view, "day30").count).toBe(2);
    expect(windowOf(view, "day30").average).toBe(137);
    expect(windowOf(view, "day90").count).toBe(1);
    expect(windowOf(view, "day90").average).toBe(131);
  });

  it("treats both window edges as inclusive", () => {
    const view = buildBeforeAfter(START, [at(-30, 10), at(0, 20), at(15, 30), at(45, 40)]);
    expect(windowOf(view, "baseline").count).toBe(2);
    expect(windowOf(view, "day30").count).toBe(2);
  });

  it("summarises the second number separately for two-number measures", () => {
    const view = buildBeforeAfter(START, [at(-10, 150, 92), at(-5, 152, 94)]);
    const baseline = windowOf(view, "baseline");
    expect(baseline.average).toBe(151);
    expect(baseline.average2).toBe(93);
    expect(baseline.min2).toBe(92);
    expect(baseline.max2).toBe(94);
  });

  it("leaves a one-number measure's second statistics null", () => {
    const baseline = windowOf(buildBeforeAfter(START, [at(-10, 7.4)]), "baseline");
    expect(baseline.average).toBe(7.4);
    expect(baseline.average2).toBeNull();
    expect(baseline.min2).toBeNull();
  });

  it("reports an empty window as empty rather than as a number", () => {
    const view = buildBeforeAfter(START, [at(-10, 150)]);
    const day30 = windowOf(view, "day30");
    expect(day30.count).toBe(0);
    expect(day30.average).toBeNull();
    expect(day30.min).toBeNull();
    expect(day30.max).toBeNull();
  });

  it("needs a baseline and at least one follow-up window before it says there is enough data", () => {
    expect(buildBeforeAfter(START, []).hasEnoughPoints).toBe(false);
    // Baseline only: nothing to line up against.
    expect(buildBeforeAfter(START, [at(-10, 150)]).hasEnoughPoints).toBe(false);
    // Follow-up only: no starting point.
    expect(buildBeforeAfter(START, [at(30, 138)]).hasEnoughPoints).toBe(false);
    expect(buildBeforeAfter(START, [at(-10, 150), at(30, 138)]).hasEnoughPoints).toBe(true);
    // Day 90 alone is a valid follow-up too.
    expect(buildBeforeAfter(START, [at(-10, 150), at(90, 131)]).hasEnoughPoints).toBe(true);
    expect(buildBeforeAfter(START, [at(-10, 150), at(30, 138)]).minimumPointsPerWindow).toBe(MIN_POINTS_PER_WINDOW);
  });

  it("never emits a comparison, a verdict, or anything implying causation", () => {
    const view = buildBeforeAfter(START, [at(-10, 150, 92), at(30, 138, 84), at(90, 131, 80)]);
    const keys = new Set<string>(Object.keys(view));
    for (const w of view.windows) for (const k of Object.keys(w)) keys.add(k);

    const forbidden = [
      "change",
      "delta",
      "difference",
      "diff",
      "improvement",
      "improved",
      "percent",
      "percentage",
      "percentchange",
      "trend",
      "direction",
      "effect",
      "effectiveness",
      "response",
      "verdict",
      "conclusion",
      "interpretation",
      "better",
      "worse",
      "caused",
      "cause",
      "impact",
      "benefit",
      "score",
      "rating",
    ];
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const word of forbidden) {
        expect(lower.includes(word)).toBe(false);
      }
    }
    // And the payload is only the windows plus their own definitions.
    expect(Object.keys(view).sort()).toEqual(["hasEnoughPoints", "minimumPointsPerWindow", "startDate", "windows"]);
  });
});
