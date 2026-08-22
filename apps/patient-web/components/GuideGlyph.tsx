"use client";

/**
 * Guidance icons — the pictures beside the app's self-explaining copy
 * (read-aloud buttons, teaching empty states, education screens), the same
 * way `MedicineGlyph` illustrates doses. Hand-drawn for the same three
 * reasons recorded there: emoji coverage gaps on old Android WebViews,
 * uncontrollable emoji colour vs. docs/33's ≥3:1 non-text contrast, and
 * missing shapes. `currentColor` on a 0 0 100 100 viewBox, sized in `em` so
 * glyphs grow with 200% text zoom, always `aria-hidden` — the visible text
 * label beside each carries the meaning (docs/33 "icons always paired with
 * text labels").
 */

export type GuideGlyphName =
  | "speaker"
  | "tablet"
  | "bell"
  | "shield"
  | "people"
  | "prescription"
  | "report"
  | "share"
  | "drop"
  | "check"
  | "install"
  | "heart"
  | "scale"
  | "question";

const SIZE_EM = { sm: "1em", md: "1.35em", lg: "3em" } as const;
export type GuideGlyphSize = keyof typeof SIZE_EM;

function paths(name: GuideGlyphName) {
  switch (name) {
    case "speaker":
      // Loudspeaker cone with two sound arcs — the near-universal "this
      // talks" mark, matching the shape on physical radios and TVs the
      // target user already owns.
      return (
        <>
          <path
            d="M14 38h14l24-20v64L28 62H14z"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d="M66 38a17 17 0 010 24" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <path d="M78 27a34 34 0 010 46" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        </>
      );
    case "tablet":
      // Same scored round pill as MedicineGlyph — one shape, one meaning.
      return (
        <>
          <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="10" />
          <line x1="24" y1="50" x2="76" y2="50" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
        </>
      );
    case "bell":
      return (
        <>
          <path
            d="M50 12a26 26 0 0126 26v18l8 12H16l8-12V38a26 26 0 0126-26z"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d="M42 76a8 8 0 0016 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        </>
      );
    case "shield":
      return (
        <>
          <path
            d="M50 10l32 12v24c0 22-14 36-32 44C32 82 18 68 18 46V22z"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d="M35 50l11 11 20-24" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "people":
      // One person in front, one behind — "someone helping you".
      return (
        <>
          <circle cx="38" cy="32" r="14" fill="none" stroke="currentColor" strokeWidth="9" />
          <path d="M14 84c0-15 11-26 24-26s24 11 24 26" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <circle cx="72" cy="36" r="11" fill="none" stroke="currentColor" strokeWidth="8" />
          <path d="M68 84c1-12 8-20 18-21" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "prescription":
      // Paper with a folded corner and writing lines — the doctor's chit.
      return (
        <>
          <path d="M26 10h34l16 16v64H26z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <path d="M60 10v16h16" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <line x1="36" y1="48" x2="66" y2="48" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <line x1="36" y1="62" x2="66" y2="62" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "report":
      // Same paper, but carrying a result line instead of prose — a chart
      // means numbers, which is how a lab report differs from a chit.
      return (
        <>
          <path d="M26 10h34l16 16v64H26z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <path d="M60 10v16h16" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />
          <path d="M34 68l12-14 8 8 14-18" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "share":
      // Three connected dots — the shape every share sheet already uses.
      return (
        <>
          <circle cx="26" cy="50" r="11" fill="none" stroke="currentColor" strokeWidth="8" />
          <circle cx="74" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth="8" />
          <circle cx="74" cy="76" r="11" fill="none" stroke="currentColor" strokeWidth="8" />
          <line x1="36" y1="45" x2="64" y2="29" stroke="currentColor" strokeWidth="8" />
          <line x1="36" y1="55" x2="64" y2="71" stroke="currentColor" strokeWidth="8" />
        </>
      );
    case "drop":
      // Same droplet as MedicineGlyph — here it means a blood-sugar test.
      return <path d="M50 12C30 40 24 54 24 64a26 26 0 0052 0c0-10-6-24-26-52z" fill="none" stroke="currentColor" strokeWidth="9" strokeLinejoin="round" />;
    case "check":
      return (
        <>
          <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="9" />
          <path d="M33 52l12 12 22-26" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "install":
      // A phone with an arrow landing on it — the app arriving on the device.
      return (
        <>
          <rect x="28" y="26" width="44" height="64" rx="8" fill="none" stroke="currentColor" strokeWidth="9" />
          <line x1="42" y1="78" x2="58" y2="78" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <line x1="50" y1="6" x2="50" y2="46" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <path d="M38 36l12 14 12-14" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "heart":
      // A plain heart — blood pressure. The one shape every BP monitor
      // carton in an Indian pharmacy already prints.
      return (
        <path
          d="M50 84C30 68 16 55 16 40a19 19 0 0134-11 19 19 0 0134 11c0 15-14 28-34 44z"
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          strokeLinejoin="round"
        />
      );
    case "scale":
      // A bathroom scale seen from above: square body, dial window at the
      // top — where the feet go is where the eye already knows to look.
      return (
        <>
          <rect x="16" y="16" width="68" height="68" rx="12" fill="none" stroke="currentColor" strokeWidth="9" />
          <path d="M34 44a16 16 0 0132 0" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <line x1="50" y1="44" x2="58" y2="34" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        </>
      );
    case "question":
      // Circled question mark — help.
      return (
        <>
          <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="9" />
          <path d="M38 40a12 13 0 1124 8c-6 5-10 7-10 14" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <line x1="52" y1="74" x2="52" y2="75" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
        </>
      );
  }
}

export function GuideGlyph({ name, size = "md" }: { name: GuideGlyphName; size?: GuideGlyphSize }) {
  const em = SIZE_EM[size];
  return (
    <svg
      width={em}
      height={em}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      {paths(name)}
    </svg>
  );
}
