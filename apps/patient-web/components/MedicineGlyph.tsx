"use client";

/**
 * The picture half of "icons with labels" (docs/33, docs/01 persona P3) —
 * medicine forms and times of day, for a patient who can't read the
 * instruction line beside them.
 *
 * Hand-drawn rather than emoji, following the only existing vector precedent
 * in the app (`PillSpinner`, itself a redraw of `public/icons/icon.svg`).
 * Three reasons emoji couldn't do this job: there is no inhaler emoji and no
 * way to tell syrup from injection; emoji colour can't be controlled, and
 * docs/33 requires ≥3:1 contrast for non-text (the brand green measures
 * 6.46:1 on white, 6.06:1 on a card); and the target device is an old Android
 * (docs/01) whose WebView emoji coverage varies — a missing glyph renders as
 * a tofu box.
 *
 * Every glyph is `currentColor` on a 0 0 100 100 viewBox, and always
 * `aria-hidden` — the text label next to it carries the meaning.
 */

export type GlyphName =
  // Dose units (packages/domain DOSE_UNITS)
  | "tablet"
  | "tablet-half"
  | "capsule"
  | "ml"
  | "drop"
  | "puff"
  | "sachet"
  | "unit"
  | "application"
  // Time-of-day slots (SlotDose["slot"])
  | "morning"
  | "midday"
  | "night";

/**
 * Sized in `em`, not px, so glyphs grow with the surrounding text when the
 * OS font size or browser zoom is raised — docs/33 requires 200% without loss
 * of function, and a pill frozen at 22px beside doubled text reads as a bug.
 * (`PillSpinner` uses fixed px, which is right for a standalone spinner and
 * wrong for a glyph sitting inline with a label.)
 */
const SIZE_EM = { sm: "1em", md: "1.35em", lg: "1.75em" } as const;
export type GlyphSize = keyof typeof SIZE_EM;

/**
 * Paths are deliberately simple geometry — these render at 16–28 px on a
 * cheap phone, where detail turns to mud.
 */
function paths(name: GlyphName) {
  switch (name) {
    case "tablet":
      // Round pill, scored across the middle like a real divisible tablet.
      return (
        <>
          <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="10" />
          <line x1="24" y1="50" x2="76" y2="50" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
        </>
      );
    case "tablet-half":
      // Left half only — a tablet broken on its score line.
      return (
        <path
          d="M50 12a38 38 0 000 76z"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinejoin="round"
        />
      );
    case "capsule":
      // Two-tone capsule at the app-icon's 45°, matching PillSpinner.
      return (
        <g transform="rotate(45 50 50)">
          <rect x="32" y="14" width="36" height="72" rx="18" fill="none" stroke="currentColor" strokeWidth="10" />
          <path d="M32 50h36" stroke="currentColor" strokeWidth="10" />
        </g>
      );
    case "ml":
      // Medicine cup, with a fill line. A spoon was tried first and read as a
      // magnifying glass at 16px — an ellipse on a stick is the same shape as
      // a lens on a handle. The tapered cup has no such twin.
      return (
        <>
          <path d="M26 22h48l-7 62a6 6 0 01-6 5H39a6 6 0 01-6-5z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <line x1="31" y1="52" x2="69" y2="52" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "drop":
      return <path d="M50 12C30 40 24 54 24 64a26 26 0 0052 0c0-10-6-24-26-52z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />;
    case "puff":
      // Inhaler seen side-on: the L of body-plus-mouthpiece is the shape
      // people recognise, and it survives 16px better than a canister nested
      // inside a mouthpiece (which just became a filled blob).
      return (
        <>
          <path d="M34 16h26v40a10 10 0 01-10 10H34z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <path d="M34 66v14a8 8 0 008 8h18" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <g stroke="currentColor" strokeWidth="7" strokeLinecap="round">
            <line x1="72" y1="24" x2="88" y2="18" />
            <line x1="74" y1="44" x2="90" y2="44" />
          </g>
        </>
      );
    case "sachet":
      // Pouch with a serrated tear-strip along the top.
      return (
        <>
          <rect x="22" y="24" width="56" height="62" rx="6" fill="none" stroke="currentColor" strokeWidth="9" />
          <path d="M22 38h56" stroke="currentColor" strokeWidth="8" strokeDasharray="8 7" />
          <path d="M34 24v-8m16 8v-8m16 8v-8" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "unit":
      // Syringe, drawn flat rather than at an angle: at 16px a rotated barrel
      // loses its silhouette and the graduation ticks smear together. The
      // ticks matter — an insulin dose is *units*, i.e. marks on the barrel.
      return (
        <>
          <rect x="24" y="36" width="44" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth="9" />
          <line x1="10" y1="50" x2="24" y2="50" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <line x1="12" y1="38" x2="12" y2="62" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <line x1="68" y1="50" x2="92" y2="50" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <g stroke="currentColor" strokeWidth="6" strokeLinecap="round">
            <line x1="38" y1="40" x2="38" y2="48" />
            <line x1="50" y1="40" x2="50" y2="48" />
          </g>
        </>
      );
    case "application":
      // Squeezed tube with a crimped end.
      return (
        <>
          <path d="M32 40h40v42a6 6 0 01-6 6H38a6 6 0 01-6-6z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <path d="M32 40l8-16h24l8 16" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <line x1="44" y1="14" x2="60" y2="14" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        </>
      );
    case "morning":
      // Sun with rays.
      return (
        <>
          {/* Solid disc with short stubby rays — an outlined circle with thin
              rays read as an asterisk at 16px. */}
          <circle cx="50" cy="50" r="20" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="10" strokeLinecap="round">
            <line x1="50" y1="6" x2="50" y2="18" />
            <line x1="50" y1="82" x2="50" y2="94" />
            <line x1="6" y1="50" x2="18" y2="50" />
            <line x1="82" y1="50" x2="94" y2="50" />
            <line x1="19" y1="19" x2="28" y2="28" />
            <line x1="72" y1="72" x2="81" y2="81" />
            <line x1="19" y1="81" x2="28" y2="72" />
            <line x1="72" y1="28" x2="81" y2="19" />
          </g>
        </>
      );
    case "midday":
      // A plate — docs/33's own vocabulary is "sun/plate/moon", and the midday
      // dose is the one anchored to a meal, not a second sun the patient would
      // confuse with morning.
      //
      // Reserved, so a later change doesn't collide: docs/07 screen 8 wants a
      // *food instruction* icon (before/with/after food). That one must be
      // fork-and-knife, never a plate — a plate means midday here, and one
      // shape cannot mean two things on the same tile.
      return (
        <>
          <circle cx="50" cy="52" r="32" fill="none" stroke="currentColor" strokeWidth="9" />
          <circle cx="50" cy="52" r="14" fill="currentColor" />
        </>
      );
    case "night":
      // Crescent moon.
      return <path d="M66 20a34 34 0 100 60 40 40 0 010-60z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />;
  }
}

export function MedicineGlyph({ name, size = "md" }: { name: GlyphName; size?: GlyphSize }) {
  const em = SIZE_EM[size];
  return (
    <svg
      width={em}
      height={em}
      viewBox="0 0 100 100"
      // Decorative: the label beside it is what a screen reader reads
      // (docs/33 "icons always paired with text labels").
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      {paths(name)}
    </svg>
  );
}

/** Dose units map 1:1 onto glyph names; anything unrecognized falls back to the tablet. */
export function glyphForDoseUnit(doseUnit: string): GlyphName {
  switch (doseUnit) {
    case "tablet":
    case "capsule":
    case "ml":
    case "drop":
    case "puff":
    case "sachet":
    case "unit":
    case "application":
      return doseUnit;
    default:
      return "tablet";
  }
}
