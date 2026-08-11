/**
 * Interim illustrations for the S2 story cards — flat warm minimalism per
 * docs/landing-page/05 §8 (ink line work; green/clay/sand fills only; no
 * faces, no photorealism, nothing readable as a real patient). These are
 * deliberate Session 7 stand-ins in the approved style; the commissioned
 * canonical family (Session 8/9) replaces them file-for-file. 3:2 ratio.
 */
const INK = "#1a1f1d";
const GREEN = "#0f6b54";
const SOFT = "#e3f2ed";
const CLAY = "#b65c32";
const SAND = "#e8dcc7";
const PAPER = "#fbfaf7";

/** Story A — strips, papers and a phone, nothing that answers the question. */
export function IllustrationScatter() {
  return (
    <svg viewBox="0 0 360 240" role="img" aria-label="Loose medicine strips, folded prescriptions and a phone, scattered on a table">
      <rect width="360" height="240" fill={PAPER} />
      <ellipse cx="180" cy="200" rx="130" ry="10" fill={SAND} />
      <g transform="translate(50,96) rotate(-10)">
        <rect width="92" height="52" rx="8" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <circle cx="20" cy="18" r="7" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="42" cy="18" r="7" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="64" cy="18" r="7" fill={SOFT} stroke={INK} strokeWidth="2" />
        <rect x="12" y="34" width="52" height="7" rx="3.5" fill={GREEN} />
      </g>
      <g transform="translate(150,70) rotate(4)">
        <rect width="80" height="104" rx="6" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <rect x="12" y="14" width="46" height="6" rx="3" fill={SAND} />
        <rect x="12" y="28" width="56" height="5" rx="2.5" fill={SAND} />
        <rect x="12" y="40" width="40" height="5" rx="2.5" fill={SAND} />
        <path d="M12 64 q14 -10 24 0 q10 8 20 -4" fill="none" stroke={CLAY} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M12 82 q12 -8 22 0 q10 6 22 -6" fill="none" stroke={CLAY} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g transform="translate(252,92) rotate(9)">
        <rect width="56" height="100" rx="10" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <rect x="8" y="12" width="40" height="56" rx="4" fill={SOFT} />
        <rect x="18" y="80" width="20" height="6" rx="3" fill={INK} opacity=".5" />
      </g>
      <text x="36" y="52" fontFamily="inherit" fontSize="30" fontWeight="800" fill={INK}>
        ?
      </text>
    </svg>
  );
}

/** Story B — two different strips casting the same shadow (neutral concept). */
export function IllustrationTwoNames() {
  return (
    <svg viewBox="0 0 360 240" role="img" aria-label="Two medicine strips with different labels casting the same shadow">
      <rect width="360" height="240" fill={PAPER} />
      <ellipse cx="180" cy="196" rx="118" ry="10" fill={SAND} />
      <g transform="translate(58,74) rotate(-8)">
        <rect width="118" height="64" rx="10" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <circle cx="24" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="52" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="80" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <rect x="14" y="42" width="66" height="8" rx="4" fill={GREEN} />
      </g>
      <g transform="translate(192,84) rotate(6)">
        <rect width="118" height="64" rx="10" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <circle cx="24" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="52" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <circle cx="80" cy="22" r="9" fill={SOFT} stroke={INK} strokeWidth="2" />
        <rect x="14" y="42" width="66" height="8" rx="4" fill={CLAY} />
      </g>
      <path d="M96 52 q10 -18 26 -8" fill="none" stroke="#52605b" strokeWidth="2" strokeDasharray="1 6" strokeLinecap="round" />
      <path d="M262 60 q-8 -20 -26 -12" fill="none" stroke="#52605b" strokeWidth="2" strokeDasharray="1 6" strokeLinecap="round" />
    </svg>
  );
}

/** Story C — two homes, two cities, one thin green thread between them. */
export function IllustrationTwoCities() {
  return (
    <svg viewBox="0 0 360 240" role="img" aria-label="Two homes in different cities connected by a single green thread">
      <rect width="360" height="240" fill={PAPER} />
      <ellipse cx="88" cy="196" rx="72" ry="9" fill={SAND} />
      <ellipse cx="276" cy="196" rx="72" ry="9" fill={SAND} />
      <g transform="translate(46,110)">
        <path d="M0 40 L42 6 L84 40" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        <rect x="10" y="40" width="64" height="48" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <rect x="34" y="58" width="16" height="30" fill={GREEN} />
        <rect x="18" y="50" width="10" height="10" fill={SOFT} stroke={INK} strokeWidth="1.5" />
      </g>
      <g transform="translate(226,96)">
        <rect x="0" y="18" width="34" height="84" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <rect x="42" y="34" width="34" height="68" fill="#fff" stroke={INK} strokeWidth="2.5" />
        {[0, 1, 2].map((r) => (
          <g key={r}>
            <rect x="7" y={26 + r * 22} width="8" height="8" fill={SOFT} stroke={INK} strokeWidth="1.5" />
            <rect x="19" y={26 + r * 22} width="8" height="8" fill={SOFT} stroke={INK} strokeWidth="1.5" />
            <rect x="49" y={42 + r * 18} width="8" height="8" fill={SOFT} stroke={INK} strokeWidth="1.5" />
            <rect x="61" y={42 + r * 18} width="8" height="8" fill={SOFT} stroke={INK} strokeWidth="1.5" />
          </g>
        ))}
      </g>
      <path d="M132 132 C 176 76, 200 76, 232 122" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 9" />
      <circle cx="132" cy="132" r="4" fill={GREEN} />
      <circle cx="232" cy="122" r="4" fill={GREEN} />
    </svg>
  );
}
