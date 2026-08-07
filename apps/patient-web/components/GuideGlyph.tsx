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

export type GuideGlyphName = "speaker";

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
