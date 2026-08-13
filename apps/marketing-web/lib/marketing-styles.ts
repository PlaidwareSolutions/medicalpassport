import { cssVariables } from "@medpass/design-tokens";

/**
 * Marketing semantic token layer + global CSS (docs/landing-page/05).
 * Builds on the shared product tokens (cssVariables()) — marketing-specific
 * values are semantic tokens per the Session 4 gate ruling, never hardcoded
 * in components. Injected as one <style> block from the root layouts,
 * mirroring patient-web's pattern. No CSS framework, no webfonts.
 */
const marketingTokens = `:root{
  --mkt-primary:#0f6b54;
  --mkt-primary-hover:#0c5745;
  --mkt-primary-pressed:#094636;
  --mkt-soft:#e3f2ed;
  --mkt-ink:#1a1f1d;
  --mkt-muted:#52605b;
  --mkt-paper:#fbfaf7;
  --mkt-surface:#ffffff;
  --mkt-hairline:#d8ded9;
  --mkt-border-control:#8a8e8c;
  --mkt-caption:#22302b;
  --mkt-ill-clay:#b65c32;
  --mkt-ill-sand:#e8dcc7;
  --mkt-width-text:720px;
  --mkt-width-wide:1140px;
  --mkt-gutter:20px;
  --mkt-section-y:64px;
  --mkt-radius-frame:28px;
}
@media (min-width:768px){:root{--mkt-gutter:32px;--mkt-section-y:96px;}}
@media (max-width:359px){:root{--mkt-gutter:16px;}}`;

const globalCss = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--mkt-paper);color:var(--mkt-ink);
  font-family:var(--font-family);font-size:17px;line-height:1.6;
  -webkit-font-smoothing:antialiased}
main{display:block}
h1,h2,h3,h4,p,ul,ol{margin:0}
h1{font-size:2rem;line-height:1.15;font-weight:800;letter-spacing:-0.015em;text-wrap:balance}
h2{font-size:1.625rem;line-height:1.2;font-weight:750;letter-spacing:-0.01em;text-wrap:balance}
h3{font-size:1.25rem;line-height:1.3;font-weight:700}
h4{font-size:1.0625rem;line-height:1.4;font-weight:700}
@media (min-width:768px){
  body{font-size:18px}
  h1{font-size:3.375rem;line-height:1.08}
  h2{font-size:2.25rem;line-height:1.15}
  h3{font-size:1.375rem}
  h4{font-size:1.125rem}
}
a{color:var(--mkt-primary)}
img,svg,video{max-width:100%;height:auto}
button{font:inherit}
/* Keep anchor jumps and keyboard focus clear of the sticky header (WCAG 2.2
   2.4.11 Focus Not Obscured): reserve the header's height at the top of every
   programmatic scroll. Covers in-page anchors (hero "see how it works", legal
   TOC) and Tab/Shift-Tab focus. */
html{scroll-padding-top:6rem}
:focus-visible{outline:2px solid var(--mkt-primary-hover);outline-offset:2px}
.on-primary :focus-visible{outline-color:#ffffff}
.mkt-container{max-width:var(--mkt-width-wide);margin-inline:auto;padding-inline:var(--mkt-gutter)}
.mkt-container-text{max-width:var(--mkt-width-text);margin-inline:auto;padding-inline:var(--mkt-gutter)}
.mkt-section{padding-block:var(--mkt-section-y)}
.mkt-muted{color:var(--mkt-muted)}
.mkt-skip{position:absolute;inset-inline-start:8px;top:-100px;z-index:20;background:var(--mkt-surface);
  color:var(--mkt-primary);padding:12px 16px;border-radius:8px;font-weight:700;text-decoration:none;
  box-shadow:0 2px 8px rgba(26,31,29,.15)}
.mkt-skip:focus-visible{top:8px}
.mkt-hero-grid{display:grid;gap:48px;grid-template-columns:1fr;align-items:center}
@media (min-width:900px){.mkt-hero-grid{grid-template-columns:55fr 45fr}}
/* P2 alternating media row (05 §5): copy first in DOM = reading order kept on mobile */
.mkt-p2{display:grid;gap:40px;grid-template-columns:1fr;align-items:center}
/* Grid children default to min-width:auto and refuse to shrink below their
   content's min-content width, overflowing the viewport at 320px. Let them
   shrink so long text wraps instead. */
.mkt-p2>*,.mkt-hero-grid>*{min-width:0}
@media (min-width:900px){
  .mkt-p2{grid-template-columns:7fr 5fr;gap:64px}
  .mkt-p2.mkt-media-left .mkt-p2-copy{order:2}
  .mkt-p2.mkt-media-left{grid-template-columns:5fr 7fr}
}
/* P3 statement panel (S10) */
.mkt-panel{background:var(--mkt-primary);color:#ffffff;text-align:center}
.mkt-panel h2,.mkt-panel p{color:#ffffff}
.mkt-panel .mkt-panel-in{max-width:var(--mkt-width-text);margin-inline:auto;padding-inline:var(--mkt-gutter);padding-block:80px}
@media (min-width:768px){.mkt-panel .mkt-panel-in{padding-block:128px}}
/* Story cards (S2) */
.mkt-stories{display:grid;gap:24px;grid-template-columns:1fr;margin-top:32px}
@media (min-width:1100px){.mkt-stories{grid-template-columns:1fr 1fr 1fr;gap:28px}}
.mkt-story{background:var(--mkt-surface);border:1px solid var(--mkt-hairline);border-radius:16px;overflow:hidden}
.mkt-story svg{display:block;width:100%;height:auto}
.mkt-story-body{padding:18px 18px 20px}
.mkt-story-body h3{margin-bottom:8px}
/* Trust cards (S11) */
.mkt-trust{display:grid;gap:24px;grid-template-columns:1fr;margin-top:32px}
@media (min-width:900px){.mkt-trust{grid-template-columns:1fr 1fr;gap:28px}}
.mkt-tcard{background:var(--mkt-surface);border:1px solid var(--mkt-hairline);border-radius:16px;padding:26px 28px}
.mkt-tcard h3{margin-bottom:14px}
.mkt-tcard ul{list-style:none;margin:0;padding:0}
.mkt-tcard li{padding:7px 0 7px 30px;position:relative;line-height:1.5}
.mkt-does li::before{content:"✓";position:absolute;inset-inline-start:0;color:var(--mkt-primary);font-weight:800}
.mkt-not li::before{content:"–";position:absolute;inset-inline-start:0;color:var(--mkt-muted);font-weight:800}
/* FAQ (S13): always visible, no accordions */
.mkt-faq{max-width:var(--mkt-width-text);margin-inline:auto}
.mkt-faq-item{padding-block:24px;border-bottom:1px solid var(--mkt-hairline)}
.mkt-faq-item:last-child{border-bottom:none}
.mkt-faq-item h3{margin-bottom:8px}
/* Reveal card (S3) */
.mkt-passport-card{background:var(--mkt-surface);border:1px solid var(--mkt-hairline);border-radius:16px;padding:22px 24px;max-width:420px;margin-inline:auto}
.mkt-passport-card dl{margin:0;display:grid;gap:12px}
.mkt-passport-card div{border-inline-start:2px solid var(--mkt-primary);padding-inline-start:12px}
.mkt-passport-card dt{font-size:0.8125rem;font-weight:650;color:var(--mkt-muted);letter-spacing:.02em}
.mkt-passport-card dd{margin:2px 0 0;font-weight:700}
/* Intentional media placeholder (Session 7 §24) */
.mkt-ph{aspect-ratio:390/780;width:100%;border-radius:calc(var(--mkt-radius-frame) - 8px);
  background:var(--mkt-soft);display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;padding:20px;text-align:center;border:1.5px dashed rgba(15,107,84,.35)}
.mkt-ph-badge{background:var(--mkt-surface);color:var(--mkt-primary);border-radius:999px;
  padding:4px 12px;font-size:0.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.mkt-ph-play{width:44px;height:44px;border-radius:999px;background:var(--mkt-primary);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:1rem}
/* Language strip (S6): 2×2 on mobile, 4-across on desktop — no horizontal
   scroll (an overflow-x grid here escaped its container at 320px). */
.mkt-langs{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-block:8px}
@media (min-width:900px){.mkt-langs{grid-template-columns:repeat(4,1fr)}}
.mkt-lang-card{background:var(--mkt-surface);border:1px solid var(--mkt-hairline);border-radius:14px;
  padding:14px;display:flex;flex-direction:column;gap:10px;min-height:120px}
.mkt-lang-card b{font-size:1.125rem}
.mkt-lang-listen{display:inline-flex;align-items:center;gap:6px;color:var(--mkt-primary);
  font-weight:650;font-size:0.8125rem;margin-top:auto}
/* Scroll reveal — progressive enhancement only: zero JS, content fully
   visible wherever scroll-driven animations are unsupported or motion is reduced */
@media (prefers-reduced-motion: no-preference){
  @supports (animation-timeline: view()){
    .mkt-reveal{animation:mkt-rise both;animation-timeline:view();animation-range:entry 0% entry 35%}
    /* Transform-only rise (no opacity fade): the scroll-driven mid-animation
       state must never drop text below contrast — otherwise axe flags the
       transient faint state as a color-contrast failure (Session 18). */
    @keyframes mkt-rise{from{transform:translateY(8px)}to{transform:none}}
  }
}
.mkt-desktop-only{display:none}
@media (min-width:768px){.mkt-desktop-only{display:inline}}
.mkt-desktop-flex{display:none}
@media (min-width:900px){.mkt-desktop-flex{display:flex}}
/* Locale switcher (§28) — native <details> disclosure, RTL-aware, keyboard accessible. */
.mkt-lang{position:relative}
.mkt-lang-summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;
  border:1px solid var(--mkt-hairline);border-radius:999px;padding:5px 12px;font-weight:600;
  font-size:0.8125rem;background:var(--mkt-surface);min-height:var(--size-touch);box-sizing:border-box}
.mkt-lang-summary::-webkit-details-marker{display:none}
.mkt-lang-summary:focus-visible{outline:2px solid var(--mkt-primary);outline-offset:2px}
.mkt-lang-caret{font-size:0.7rem;color:var(--mkt-muted)}
.mkt-lang[open] .mkt-lang-caret{transform:rotate(180deg)}
.mkt-lang-menu{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:20;margin:0;
  list-style:none;padding:6px;min-width:160px;background:var(--mkt-surface);
  border:1px solid var(--mkt-hairline);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.10)}
.mkt-lang-item{display:block;padding:10px 12px;border-radius:8px;text-decoration:none;
  color:var(--mkt-ink);font-weight:600;font-size:0.9375rem}
.mkt-lang-item:hover{background:var(--mkt-soft)}
.mkt-lang-item[aria-current="true"]{background:var(--mkt-soft);color:var(--mkt-primary)}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;
    transition-duration:0.01ms!important;scroll-behavior:auto!important}
}
`;

export function marketingStyles(): string {
  return cssVariables() + marketingTokens + globalCss;
}
