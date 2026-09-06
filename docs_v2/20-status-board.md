# 20 — V2 Status Board (living record)

Update this with every meaningful change. Status vocabulary: **Completed · In progress · Blocked · Mocked · Requires clinical validation · Requires security review · Requires platform configuration · Requires ABDM sandbox · Deferred.** V1 stages stay on `docs/22`.

Phase 0 start: **2026-09-08**. Dates are targets and move with capacity ([16](16-dependencies-and-risks.md)).

## Phases

| Phase | Window | Status | Notes |
|---|---|---|---|
| P0 Foundation | started early 2026-09-06 | **In progress** — engineering tickets largely done; platform-configuration tickets open | Done (2026-09-06): 0.11 `packages/provenance` (249 tests) · 0.12 migration `v2_foundation_step_up_provenance_enums` · 0.14 worker test suite (75 tests; 6 real defects logged in [16 §4](16-dependencies-and-risks.md)) · 0.15 exhaustive authz matrix (858 cells, 53 tests) · 0.16 sync contract == dispatcher (contract narrowed to the 3 dispatched pairs; 25 + 16 tests) · 0.17 safety engine moved to `packages/clinical-rules` (zero behaviour change, 27/27) · 0.19 origin security headers (`apps/api/src/common/security-headers.ts`) · 0.20 step-up auth server side (`Session.stepUpVerifiedAt`, `POST auth/step-up[/verify]`, `GET auth/session`, `@RequiresStepUp()` on share creation and caregiver invite/scopes/revoke; e2e helper) · 0.21 keyring `packages/field-crypto` (versioned ciphertext prefix instead of a keyVersion column — deviation from [04 §1] recorded; `rotate-field-encryption` cron; api + cron wired) · 0.28 `packages/terminology` v1 (31 analytes, 19 concepts, 49 tests; unmapped list for Gate 1b) · 0.29 `packages/fhir` (IG v6.5 + v7.0 folders, AllergyIntolerance + Provenance round trip, validator, 86 tests) · 0.30 `packages/health-events` (projection helpers + 10 tests). In progress: 0.13 OpenAPI pin, 0.20 client step-up sheet. Open (platform/governance): 0.2–0.6, 0.8, 0.9, 0.22–0.27, 0.31–0.34; 0.7 ESLint next |
| P1 Core PHR | 2026-09-06 | **Completed (engineering)** — clinical validation of new copy pending (Gate 4) | Migrations `v2_phase1_longitudinal_record`, `v2_phase1_recorded_by`, `v2_admin_provider_duty` applied; provenance check green on 15 tables. API: clinical profile CRUD for allergies/conditions/immunizations/procedures/family history/emergency contacts (18 e2e), organizations + merge, practitioner extensions, encounters (9 e2e), health-timeline + summary (7 e2e), `HealthEvent` emitted at every clinical write path with provenance stamped (9 tables), backfill crons `backfill-provenance` / `backfill-health-events` (3 cron tests), admin organizations/practitioners directory with `provider_admin` duty (10 e2e), OpenAPI pin now 188 operations. patient-web: `/health` timeline with trust badges (H-30 test), visits (encounters) screens, health details, conditions/allergies extended, immunizations, procedures, family history, organizations, My Health card; 246 keys × 4 locales (hi/te/ur DRAFT); 5 new Playwright cases + 132 axe/reflow/guidance checks on the new routes. Phase 2 safety rules `multiple_active_prescriptions` and `conflicting_instructions` also landed (35 golden + 10 e2e). Guidance MP3s for the new screens need a `GOOGLE_TTS_API_KEY` run (list in the P1-UI report) |
| P2 Medication | 2026-09-06 | **Completed (API)** — patient-web screens remain | Done: P2-3 safety rules (`multiple_active_prescriptions`, `conflicting_instructions`); wave-2 schema; refill plan (`GET/PUT medications/:id/refill-plan`, derivation from the confirmed schedule, two-way sync with `quantityOnHand`, 9 e2e) and the medication links `reasonConditionId`/`prescribingPractitionerId` plus instruction-level route/strength/planned-stop with copy-on-write. Line items done: created with the prescription or added later, corrected, removed, and started as a medicine through MedicationsService (9 e2e; a line with no readable dose is refused, not guessed — H-02). Prescriptions carry diagnosis, validity and follow-up. Remaining: the patient-web screens. Interaction categories **Blocked** on OD-4 |
| P3 Documents/AI | 2026-09-06 | **Completed (API + worker)** — patient-web flow remains | `packages/document-intelligence` done (interfaces, targets, confidence policy, deterministic classifier + extractor, pipeline with H-34/H-36/H-37 guards, 134 tests); schema (PatientDocument, DocumentPage, DocumentExtraction, DocumentCandidate) applied in wave 2; API and worker done: multi-page documents, classify and extract queues, candidate review, single-writer materialization enforced by a grep test, backfill cron (22 e2e + 14 worker tests). Remaining: the capture and review screens. Vendor extractors **Blocked** on OD-11/OD-12 |
| P4 Tests | 2026-09-06 | **Completed (API)** — screens remain | DiagnosticReport/Result with superseding corrections, trends with unit conversion and a separate unconvertible list, terminology endpoint, dual-write from V1, backfill cron (31 e2e). Gate 1b review items still outstanding |
| P5 Measurements | 2026-09-06 | **Completed (API)** — screens remain | Generic Observation table, batch device sync with dedupe, trends with rolling average and morning/evening split, measurement devices, dual-write from V1, backfill cron (36 e2e) |
| P6 Caregiving | started 2026-09-06 | **In progress** | Scope split done: tests/measurements/documents have their own scopes, granted additively so no existing caregiver loses access; manage_caregivers grantable by its own scope only, deliberately not by full_management. Remaining: family dashboard, scope-aware UI, caregiver notification kinds |
| P7 Sharing | weeks 21–30 | Not started | |
| P8 ABDM | weeks 4–32 | **Requires ABDM sandbox** | sandbox application is ticket 0.8 |
| P9 Clinical intelligence | weeks 25–40 | **Blocked** (OD-3, OD-4, OD-6) | |
| P10 Treatment journey | weeks 28–40 | Not started | |
| P11 Clinic | weeks 25–38 | Not started | needs D10 partners for real validation |
| P12 Pharmacy | weeks 31–42 | Not started | |
| P13 Labs | weeks 32–44 | Not started | |
| P14 Hospital | weeks 35–46 | Not started | |
| P15 IPS | month 12 | Not started | v7.x IG |
| P16 Multilingual/voice | from month 4 | Not started | |
| P17 Notifications | from month 4 | Not started | WhatsApp **Blocked** on OD-10 BSP |
| Pilot | months 12–13 | Not started | D-LEGAL prerequisites |

## Releases

| Release | Target | Status |
|---|---|---|
| V2.0 Core Patient Passport | month 3–4 | Not started |
| V2.1 Diagnostics | month 6 | Not started |
| V2.2 Home Health | month 6 | Not started |
| V2.3 Family | month 7 | Not started |
| V2.4 ABDM Beta | month 8 | Requires ABDM sandbox; pen test; OD-9 |
| V2.5 Clinical Intelligence + sunset | month 9 | Blocked on OD-3/OD-4 |
| V2.6 Clinic | month 9–10 | Not started |
| V2.7 Ecosystem | month 11 | Not started |
| V2.8 ABDM Production | month 12 | Requires ABDM sandbox exit |
| V2.9 Enterprise | months 12–15 | Not started |

## Baseline verification (2026-09-06, Windows 11 laptop; details in [01 §7](01-current-state-baseline.md))

| Check | Result |
|---|---|
| `pnpm typecheck` | 47/47 tasks, 0 errors |
| `pnpm lint` | 0 tasks (no ESLint in repo) — Phase 0 ticket 0.7 |
| Package tests (vitest) | 24/24 tasks green |
| API tests (jest) | 42/42 suites, 350/350 tests green after three Windows-portability fixes (`apps/api/package.json` test script; `apps/api/test/helpers/worker.ts`; `apps/worker/src/processors/pdf-render.ts`) — production behaviour unchanged |
| Playwright a11y/e2e (4 workers, reused the developer's running `next dev` + dev API because `reuseExistingServer` is on outside CI) | 324 passed, 5 failed: 2× Telugu 320 px reflow overflow by 7 px (Windows lacks Noto Sans Telugu; CI installs it — **environment**), 1× timezone banner "am" vs "AM" between Node's and Chromium's default locales (**test brittleness, fixed**), 1× first-run tour heading timing (**passes with 2 workers**), 1× instant-nav strict-mode violation on the medicine name (**test brittleness, fixed by scoping to the tile**) |
| Playwright reruns (2 workers) | timezone 2/2, education 6/6, instant-nav 3/4 — the remaining instant-nav failure is the offline warm-data test hitting a dev-mode `ChunkLoadError` (**environment**: dev server, not the production build). Authoritative result = Linux CI against `next start` |

## Open decisions carried from V1 that gate V2

OD-2 DPDP/residency · OD-3 licensed catalog · OD-4 interaction provider · OD-6 clinical lead · OD-7 retention windows · OD-9 DPO · OD-10 WhatsApp BSP / India SMS DLT · OD-11 OCR vendor · OD-12 AI provider contract · OD-13 observability backend · OD-17 support channel · OD-LP-6 legal owner · OD-LP-7 mailboxes · OD-LP-11 phase-3 domain redirect.

## Platform-configuration items (not code)

Railway project token for CI · `medpass-stg` project · scoped R2 tokens per env · Cloudflare token with rule permissions · rules on the `medicinepassport.app` zone · `www` + phase-3 301s · Telnyx per-env · backup key custody offline · Railway PITR verification · ABDM sandbox credentials.

## Change log

| Date | Change |
|---|---|
| 2026-09-06 | `docs_v2/` created: README, 00–20, adr/ (14 ADRs). Baseline measured. Windows portability fixes applied to api test script, worker spawn helper, PDF render Chrome flags; timezone e2e made locale-case-insensitive; instant-nav e2e locators scoped to the medicines tile. `docs/22` gained a V2 pointer. |
| 2026-09-06 (later) | Phase 2 refill plan + medication links shipped (9 e2e). A parallel agent wave for phases 2–8/11/17 was cut short by an account usage limit before writing anything; that work is queued, not lost. Note for whoever resumes: run agents in small batches — ten at once exhausted the credit budget.
| 2026-09-06 (later) | Guard-rejected responses (401/403/429, incl. `step_up_required`) were invisible in the request log because Nest runs guards before interceptors; `ProblemDetailsFilter` now logs them with the problem code (`problem.filter.spec.ts`). Worker defects 1/3/4/6 from [16 §3](16-dependencies-and-risks.md) fixed. Runbooks R-KEY-1, R-DR-3, R-REGION-1 written; infra READMEs rewritten; PR template added; product-events catalogue added to `packages/observability`. |
| 2026-09-06 (later) | Phase 0 engineering executed: new packages `provenance`, `terminology`, `fhir`, `field-crypto`, `health-events`; `clinical-rules` now hosts the engine; worker tests; authz matrix; sync contract gate; security headers; step-up auth; keyring + rotation cron; two foundation migrations. Phase 1 schema migrated (organizations, encounters, health events, provenance columns, clinical-profile extensions). Railway: the supplied token is a `medpass-prod` project token (read-only use so far; production untouched). Work is kept off `foundation` (which auto-deploys production) on a `v2` branch. |
