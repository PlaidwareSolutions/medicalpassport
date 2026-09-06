/**
 * Build-time feature flags. Plain constants on purpose: a flag here is a
 * code-review decision, not a runtime switch, so a screen can never flip
 * behaviour on one phone and not another.
 */

/**
 * Documents V2 (docs_v2/09): `/add/scan` hands off to the multi-page
 * capture → classify → review flow under `/documents`. With this off the V1
 * single-photo scan screen and its review page stay exactly as they were.
 */
export const DOCUMENTS_V2 = true;
