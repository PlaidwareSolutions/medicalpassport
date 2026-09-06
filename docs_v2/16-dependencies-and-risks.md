# 16 — Dependencies and Risks

Dependencies are things the program cannot supply for itself. Each has an owner, what it blocks, the safest interim assumption, and a decision-by date relative to the Phase 0 start (2026-09-08). V1 open decisions (`docs/24` OD-*) are referenced rather than duplicated.

## 1. Program dependencies (roadmap §40)

| ID | Dependency | Owner | Blocks | Interim assumption | Decide by |
|---|---|---|---|---|---|
| D1 | Indian medication normalization data (licensed catalog) — OD-3 | Product + clinical | Gate 1, V2.5 interactions, serious reconciliation | sample catalog, never presented as reviewed; adapter contract tests on a vendor sample | week 8 |
| D2 | Clinical terminology (SNOMED CT India affiliate licence, LOINC, RxNorm, UCUM) | Eng + compliance | FHIR boundary, ABDM conformance | starter JSON tables with local CodeSystems; export flags unmapped codes | week 6 |
| D3 | ABDM sandbox access | Product/ops | all of M8 | mock gateway with recorded fixtures | apply week 2; access expected weeks 4–8 |
| D4 | FHIR implementation version (IG v6.5 vs v7.x) | WS09 | M8C fixtures | build both folders; pin the sandbox-required one | at sandbox access |
| D5 | Clinical validation capacity (clinical lead — OD-6, pharmacist, reviewers) | Founders | every clinical gate, all patient-visible clinical copy | nothing clinical ships; Information-class content only from existing approved pipeline | week 2 |
| D6 | Hosting/security certification for ABDM production; DPDP residency position — OD-2 | Legal + Eng | V2.8, possibly region move | Singapore compute, prod DB in sfo; region-move runbook rehearsed | M8E |
| D7 | AI/OCR validation: vendor with handwriting + Indic capability — OD-11; AI provider with no-training contract — OD-12 | Eng + legal | P3 vendor extractors, dose proposal | Tesseract + deterministic extraction only | week 12 |
| D8 | WhatsApp BSP — OD-10 | Eng + commercial | WhatsApp channel | push + SMS/voice; India SMS still DLT-blocked | when reminders demand it |
| D9 | Device partners (BP monitor, glucometer, CGM, scale, oximeter) | Product | device sync beyond Web Bluetooth prototype | manual entry with context | V2.2 planning |
| D10 | Provider partnerships (2–3 clinics, 1–2 pharmacies, 1 lab) | WS17 | P11–P14 real validation, pilot | synthetic org fixtures on staging | week 20 |
| D-ABDM-1 | HIP scope for patient-generated records | NHA | Role C | not assumed | sandbox |
| D-ABDM-2 | Erase semantics for patient-confirmed imported records | Legal + NHA | M8D | erase bundle copies only | M8D |
| D-LEGAL | Legal entity, counsel sign-off (OD-LP-6), DPO/grievance (OD-9), support mailboxes (OD-LP-7), erasure operator | Founders | any external beta (V2.4) | staging-only external users until resolved | week 12 |
| D-PLAT | Railway project token for CI deploys; scoped R2 tokens per env; Cloudflare API token with rule permissions; Telnyx per-env accounts | Ops | CI-gated deploys, credential isolation, `www`/301 cutover | manual deploys continue; documented risk | week 3 |

## 2. Risk register

Scoring: likelihood L1–5 × impact I1–5.

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Clinical lead not appointed → clinical phases stall behind Information-class features | 4 | 5 | Start D5 now; sequence P0/P1 platform work that needs no clinical sign-off first | WS01 |
| R2 | ABDM sandbox access delayed months | 3 | 4 | Mock gateway; M8A–M8C built against published specs; nothing in V2.0–V2.3 depends on ABDM | WS09 |
| R3 | IG version churn (v6.5 → v7.x) invalidates fixtures | 4 | 2 | versioned layer (ADR-V2-003); both built | WS09 |
| R4 | Backfill parity fails for V1 → V2 tables (three readings tables, report values) | 3 | 4 | additive migrations; parity report gate; sunset only after zero-write release | WS12 |
| R5 | Provenance backfill mislabels OCR-derived rows as user-entered | 3 | 3 | backfill uses `PatientMedication.source = extraction` and candidate links; sample audit by clinical reviewer | WS12 |
| R6 | Licensed catalog contract slips → duplicate checks stay on sample data | 4 | 4 | D1 decide-by; adapter ready; never present sample as reviewed | WS04 |
| R7 | OCR/AI vendor cannot meet no-training terms → extraction stays English-printed only | 3 | 3 | deterministic floor keeps V2.0 useful; corpus evaluation before contract | WS07 |
| R8 | Provider portal introduces a new attack surface before pen test | 2 | 5 | pen test before V2.4; provider-web on staging only until then | WS13 |
| R9 | Notification overload as kinds multiply | 4 | 3 | per-kind controls, caps, digest; H-48 | WS08 |
| R10 | Cloudflare Free plan limits (one rate-limit rule) become a real abuse vector on new hostnames | 3 | 3 | app-level limiter stands alone (exists); plan upgrade decision in P0 | WS14 |
| R11 | Single replica, single region outage | 3 | 3 | 2 replicas for api/web in prod (V2.0); region game day; documented RTO | WS14 |
| R12 | Shared dev/prod R2 and Telnyx credentials | 3 | 4 | split in P0 (D-PLAT) | WS14 |
| R13 | Deploys not gated by CI ship a red build | 3 | 4 | `checkSuites: true`, branch protection (P0-12) | WS14 |
| R14 | Team capacity below the roadmap's multidisciplinary core | 4 | 4 | phases are parallel workstreams; fractional roles allowed; dates move with capacity | WS01 |
| R15 | Locale expansion without native clinical review changes meaning | 3 | 4 | `PUBLISHED_LOCALES` gate; H-19/H-47 process | WS02 |
| R16 | Hospital discharge workflow proposes stopped medicines as current (H-34) | 2 | 5 | discharge summaries route only to the transition workflow | WS04/WS07 |
| R17 | DPDP/NHA require India-region hosting late in the program | 2 | 4 | region-move runbook rehearsed in P0; IaC parameterized | WS14 |
| R18 | Pilot partners lack devices/connectivity | 3 | 2 | PWA offline (exists); low-end device matrix in Gate 4 | WS17 |
| R19 | Audit write on read paths causes latency under load (known deferred fix) | 3 | 3 | move audit writes off read paths in P0/P1 (queue the read-audit rows) | WS12 |
| R20 | Sunset migration irreversibility | 2 | 5 | verified backup + restore-test + parity gate + go/no-go runbook R-MIG-2 | WS12 |

## 3. Defects found while building Phase 0 (owner: WS12/WS07, fix in P1)

Surfaced by the new worker test suite on 2026-09-06:

1. **Fixed 2026-09-06.** `PDF_TEXT_ENGINE_VERSION`/`OCR_ENGINE_VERSION` were hand-pinned (1.1.1 vs installed 1.1.4); both now read the installed package version so extraction provenance cannot drift.
2. **Open (P2, needs a `retryAfter` column).** The job runner has no retry backoff: a failing job is retried on the next 500 ms poll until it dead-letters.
3. **Fixed 2026-09-06.** Stale-lock recovery: `claimNextJob` also reclaims rows `running` for more than 15 minutes (`STALE_LOCK_MINUTES`), and `shutdown()` now waits up to 60 s for the in-flight job.
4. **Fixed 2026-09-06.** OCR worker poison: a failed `createWorker` no longer stays cached; `terminateOcrWorker` tolerates a never-started worker.
5. **Open (P3 with the extraction targets).** OCR engine confidence is discarded; candidates carry fixed rule confidences.
6. **Fixed 2026-09-06.** The worker's copy of `VisitSummaryDto` had drifted from the API's (missing `profile.timezone`); a drift test now guards it.

## 4. What is explicitly not a dependency

Native app store accounts (Stages 9/10) — separate tracks. Redis — not needed (ADR-V2-006). A FHIR server product — not needed (ADR-V2-001).
