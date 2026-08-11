/**
 * Build-time release gating (OD-LP-10 + Session 3 addendum).
 *
 * The professional experience is ONE gated release unit:
 *   S9 sharing → S12 professional bridge → /for-clinics/ → professional lead path.
 *
 * While false: the /for-clinics/ route is not built (its route directory is
 * added together with the unit), no professional navigation/footer links
 * render, homepage S12 does not render, and no `#c7-lead` or `/for-clinics/`
 * href exists anywhere in the emitted output. Flipping this to true is a
 * deliberate release act, permitted only after Stage 7 security review clears
 * the sharing implementation and claims (docs/landing-page/01-decisions.md).
 *
 * ENABLED 2026-08-12: Stage 7 security review PASSED
 * (docs/landing-page/stage7-sharing-security-review.md). The flag is retained
 * (not removed) so the unit can still be built OFF if ever needed.
 */
export const PROFESSIONAL_UNIT_ENABLED = true;
