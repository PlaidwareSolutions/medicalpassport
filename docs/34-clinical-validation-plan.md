# 34 — Clinical Validation Plan

Validation gates that must pass before the safety engine (Stage 6), OCR confirmation flow (Stage 8), and any "production-ready" label ([29](29-production-readiness-checklist.md)). Each gate maps to hazards in [10-clinical-hazard-log](10-clinical-hazard-log.md).

## Governance

- **Clinical lead** (qualified physician or clinical pharmacist — to be appointed, OD-6 in [24](24-open-decisions-and-assumptions.md)) owns sign-off.
- Maker-checker: no clinical content, rule, or catalog mapping reaches patients without a second qualified reviewer's approval (`content_approvals`).
- Validation artifacts (test sets, results, sign-offs) are versioned in-repo under `docs/validation/` and referenced from release notes.

## Gate 1 — Catalog and normalization (before Stage 6 ships)

- Curated validation set: ≥ 200 common Indian products including ≥ 50 FDCs, look-alike/sound-alike pairs, multiple strengths/forms/release types.
- Pass: ≥ 98% correct product→ingredient resolution on the set; 100% of failures produce "uncertain normalization" findings (never silent). *(H-01, H-23)*

## Gate 1b — Report analyte vocabulary (before structured lab values are relied on)

The `REPORT_ANALYTES` constant (`packages/domain/src/report-analytes.ts`) ships provisional: ~30 common Indian panel analytes with canonical units, chosen to match what labs actually print. Clinical lead reviews labels and units before the vocabulary is treated as authoritative; validation artifact under `docs/validation/`. Known review items: T3 printed in both ng/mL and ng/dL by Indian labs; platelets printed both as absolute `/cumm` and as "lakhs/cumm"; blood urea vs BUN. Mitigating design until sign-off: entered values render verbatim beside the canonical unit, the report's own printed range is transcribed alongside, the original document is always filed with the values, and the app never interprets (docs/10 H-25).

## Gate 2 — Safety rules (before findings shown to patients)

Golden clinical test set covering every spec §24 clinical case, each mapped to expected findings:

| Case | Expected outcome | Hazard |
|---|---|---|
| Same ingredient under different brands | Category 1 finding | H-01 |
| Partial duplication via combination product | Category 2 | H-01, H-14 |
| Similar therapeutic classes | Category 3 | H-01 |
| Intentional duplicate prescription | Finding raised with "may be intentional" wording; resolvable as reviewed | H-15 |
| Missing ingredient data | Category 11, no false "no concerns" | H-05 |
| Conflicting strength | Category 10 | H-18 |
| Unclear unit | Category 11 + blocked confirmation until resolved | H-18 |
| Multiple prescribers | Correct attribution in findings and shares | H-12 |
| Allergy match | Category 5 | H-22-adjacent |
| No reliable interaction data | Exact fallback string; no fabricated content | H-05, H-06 |
| Low-confidence OCR | Field-level confirmation forced | H-02 |
| Completed medication still scheduled | Completion handling, no ghost reminders | H-17 |
| PRN medication interpreted incorrectly | PRN excluded from missed-dose logic | H-16 |
| Different formulations (IR vs SR) | Not treated as identical products | H-01 |
| Missing patient purpose | Card renders without inferring reason | H-04 |
| Expired medication course | Auto-transition + no reminders | H-17 |

Pass: 100% of golden set; clinical lead reviews every finding's wording in all four locales.

## Gate 3 — Alert quality (first 90 days post-launch, then continuous)

- False-positive alert rate measured via professional-review outcomes and patient "reviewed with professional" resolutions; target trend downward, threshold set by clinical lead.
- Override/ignore patterns reviewed monthly; alert fatigue treated as a safety issue *(H-04, H-15)*.

## Gate 4 — Comprehension (before public launch)

- Moderated usability sessions with ≥ 12 participants matching personas P1/P3 (older adults, low literacy, hi/te/ur speakers).
- Tasks: interpret a duplicate warning; explain what to do next; interpret missed-dose guidance; complete OCR confirmation.
- Pass: ≥ 80% correctly state "ask doctor/pharmacist, don't stop on my own" after seeing a warning *(H-04)*; misinterpretations feed wording revisions.

## Gate 5 — OCR confirmation flow (before Stage 8 ships)

- Test corpus: printed + handwritten Indian prescriptions (with consent, or synthetic), discharge summaries, strip/box/bottle photos, all target languages.
- Measure per-field precision/recall and **correction rate**; pass requires: zero paths where unconfirmed extraction becomes a confirmed record; confidence display accuracy verified; abbreviation protocol (§6) enforced on every ambiguous token *(H-02, H-03)*.

## Gate 6 — AI outputs (before any AI feature ships)

- Hallucination/unsupported-claim suite from [19](19-ai-use-and-guardrails.md): adversarial prompts, missing-data cases, prompt-injection attempts via patient notes and OCR text.
- Pass: zero clinical facts absent from approved source content in sampled outputs; automated grounding checks in CI; human clinical audit of a random sample per release *(H-06, H-07)*.

## Ongoing

- Quarterly hazard-log review; re-validation on rule/source version changes (targeted re-run of Gates 1–2); incident-triggered re-validation.
- A release is **blocked** if any gate regresses; "do not weaken clinical safety to reduce cost" applies to validation scope.
