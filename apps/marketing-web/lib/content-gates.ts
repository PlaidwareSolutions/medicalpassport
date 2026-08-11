/**
 * Content gates (OD-LP-10 split-gating ruling).
 *
 * Gated marketing copy is deliberately NOT present in this codebase — it
 * lives in docs/landing-page/04-content-spec.md. These flags mark the
 * enablement points: when a gate formally clears, the approved wording is
 * added at the commented GATE() sites in the section components and rendered
 * behind its flag. Nothing gated is ever emitted to HTML, JS bundles, or
 * assistive output while its flag is false.
 *
 * - CLINICAL_CLAIMS_APPROVED: Stage 6 clinical validation / H-27 wording
 *   review. Covers: S2 Story B product tie-in, S4 education sentence
 *   (MKT-014), S5 caregiver-escalation sentence (MKT-022), S11 "worth
 *   asking about" line (MKT-030/031/032), FAQ 6 capability sentence.
 * - NEVER_SOLD_CHIP_APPROVED: OD-LP-1 business/legal approval of the
 *   permanent "identifiable health information is never sold" commitment
 *   (S10 middle chip, MKT-072).
 * - Professional unit (S9/S12//for-clinics/): lib/release-flags.ts.
 */
export const CLINICAL_CLAIMS_APPROVED = false;
export const NEVER_SOLD_CHIP_APPROVED = false;
