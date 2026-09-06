# 06 — Phase Plan

Phases follow the roadmap §9–§26 with the same numbering. Each phase lists: window (relative to Phase 0 start 2026-09-08), entry gate, work packages with the repo location they touch, exit gate, and the release it feeds ([15](15-release-strategy.md)). Work packages are sized S (≤ 3 days), M (≤ 2 weeks), L (≤ 6 weeks) for one engineer. Everything is additive to V1 unless marked **sunset**.

```
MONTH        1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
P0 Foundation ███
P1 Core PHR      █████
P2 Medication    ███████
P3 Documents/AI     ███████
P4 Tests               █████
P5 Measurements        █████
P6 Caregiving             █████
P7 Sharing                █████
P8 ABDM          █████████████████
P9 Clinical intel            ███████████
P10 Journey                     ███████
P11 Clinic                   █████████
P12 Pharmacy                       ███████
P13 Labs                           ███████
P14 Hospital                          ███████
P15 IPS                                  █████
P16 Multilingual/voice   ██████████████████████
P17 Notifications        ██████████████████████
Pilot                                    █████
Scale                                       ███████
```

---

## P0 — V2 Foundation (weeks 1–4)

**Entry:** this docs set reviewed by the owner; baseline in [01](01-current-state-baseline.md) accepted.

| WP | Work package | Where | Size |
|---|---|---|---|
| P0-1 | ADR-V2-001…014 accepted; `docs/24` gains a pointer | `docs_v2/adr` | S |
| P0-2 | Provenance package: enums, state machine, validators, tests | `packages/provenance` | S |
| P0-3 | `v2_provenance_enums` migration (extend `RecordSource`, add `VerificationState`) | `packages/database` | S |
| P0-4 | Quality infrastructure: ESLint (typescript-eslint, jsx-a11y, import order) with `lint` scripts in every package; CI step; fix or baseline-ignore existing findings | root, all packages, `.github/workflows/ci.yml` | M |
| P0-5 | OpenAPI generation from Nest + Zod; pinned `apps/api/openapi.json`; CI diff gate; generated types consumed by `packages/api-client` | `apps/api`, `packages/api-client` | M |
| P0-6 | Worker test suite (unit for candidate detection, PDF HTML rendering drift test against the API DTO, integration for queue claim/retry/DLQ) | `apps/worker` | M |
| P0-7 | Authorization matrix test generated from `CaregiverScope` × entity map (exhaustive) | `packages/authorization` | S |
| P0-8 | Sync contract == dispatcher test; implement or drop the four undispatched entities | `apps/api/modules/sync`, `packages/offline-sync` | S |
| P0-9 | API security headers at origin (helmet, CSP report-only for API JSON, `Referrer-Policy`, `Permissions-Policy`) | `apps/api/src/main.ts` | S |
| P0-10 | Step-up authentication (`Session.stepUpVerifiedAt`, `auth/step-up`, guard decorator) | `apps/api/modules/auth` | M |
| P0-11 | Encryption keyring: `FIELD_ENCRYPTION_KEYS` (versioned), `keyVersion` columns on the three encrypted fields, re-encrypt job, rotation runbook executed once on dev | `apps/api/src/common/crypto.ts`, `packages/config`, `packages/database` | M |
| P0-12 | Deploy gating: Railway `checkSuites: true` on both projects; real `medpass-stg` project created from `railway.ts` split; rollback rehearsed with a named deployment | `.railway/*.ts`, `ci.yml` | M (platform config) |
| P0-13 | Observability backend chosen (OD-13) and wired: OTLP exporter from `packages/observability`, dashboards for the seven SLIs in [14](14-observability-and-operations.md), alert routes | `packages/observability`, Railway | M |
| P0-14 | Doc hygiene: rewrite `infra/railway/README.md` and `infra/cloudflare/README.md` from the IaC files; mark ADR-3/ADR-4 superseded | `infra/`, `docs/24` | S |
| P0-15 | ABDM sandbox application submitted (NHA portal), M1/M2/M3 ABHA API docs and the current NRCeS IG versions pinned into `packages/fhir/IG-VERSIONS.md` | ops + `packages/fhir` | S (lead time weeks) |
| P0-16 | Clinical Safety Board constituted (physician, pharmacist, product, compliance); Privacy & Security Board; Architecture Board; Product Council — charters in [18](18-team-and-governance.md) | governance | S |
| P0-17 | Data-protection impact assessment v1; retention strategy table; threat model update for provider portal + ABDM | [11](11-security-privacy-compliance.md) | M |
| P0-18 | Windows/dev-loop portability kept green (`pnpm test` on Windows in a scheduled CI job on `windows-latest` for the api suite) | `ci.yml` | S |

**Exit gate (M0):** architecture, clinical model, security architecture and ABDM strategy approved by the respective boards; ADRs accepted; CI runs lint + typecheck + tests + e2e + OpenAPI diff; deploys gated on CI; step-up and keyring live on staging; sandbox application acknowledged.

---

## P1 — Core longitudinal health record (weeks 5–12)

**Entry:** P0 exit.

| WP | Work package | Where | Size |
|---|---|---|---|
| P1-1 | Migrations 2–6 from [04 §14](04-canonical-clinical-model.md): organizations, practitioner extensions, encounters, health events, provenance columns + backfill + NOT NULL, conditions/allergies extensions, immunizations/procedures/family history, emergency contacts, blood group | `packages/database` | L |
| P1-2 | `packages/health-events` with per-entity projection rules; wire into every existing write service in the same transaction; backfill job | `packages/health-events`, `apps/api` | M |
| P1-3 | API: encounters, organizations, clinical profile CRUD, health-timeline endpoints ([05 §2–3](05-api-contracts-v2.md)) | `apps/api` | M |
| P1-4 | patient-web: Health Timeline screen (infinite scroll, kind filters, trust badges), Encounter detail, clinical profile screens (conditions with status/dates, allergies with category, immunizations, procedures, family history, emergency contacts), My Health summary card on Home | `apps/patient-web` | L |
| P1-5 | Provenance badges and copy in 4 locales; guidance audio regenerated for new copy | `packages/localization`, audio | S |
| P1-6 | Admin: organizations directory (global entries), providers page | `apps/admin-web` | S |
| P1-7 | Product metrics pipeline without PHI: `ProductEvent` table or OTLP events for the acquisition/activation/engagement metrics in roadmap §33 | `packages/observability`, `apps/api` | M |
| P1-8 | Hazard log entries H-29…H-33 (timeline misordering, provenance mislabel, encounter linking wrong visit, family-history misattribution, timeline exposing caregiver-only data) reviewed by the Safety Board | [10](10-clinical-safety-and-ai-governance.md) | S |

**Exit gate (M1):** a synthetic 24-month patient can reconstruct their history chronologically from the timeline alone; every clinical row has non-null provenance; e2e `timeline.e2e-spec.ts` green; axe/reflow suite green for the new screens in all four locales.

---

## P2 — Medication and prescription platform (weeks 7–18)

| WP | Work package | Where | Size |
|---|---|---|---|
| P2-1 | Migration 7: `PrescriptionItem`, instruction fields (route, strength, duration, planned stop), condition/practitioner links, refill plans, `MedicationChange` kinds | `packages/database` | M |
| P2-2 | API: prescription items, start-medication-from-item, refill plan, extended history | `apps/api/modules/{prescriptions,medications}` | M |
| P2-3 | Safety: multiple-active-prescription overlap check; conflicting-instruction check across prescriptions; explanations; rule versions | `packages/clinical-rules` (engine moved here), `apps/api/modules/safety` | M |
| P2-4 | Move the engine from `apps/api/src/modules/safety/safety-rules.ts` into `packages/clinical-rules` with zero behaviour change (golden tests copied first) | packages | S |
| P2-5 | patient-web: prescription detail with line items and "start this medicine", medicine detail with why/who/when/changes, refill plan editor | `apps/patient-web` | M |
| P2-6 | Licensed Indian catalog adapter interface finalized; import job skeleton; contract tests against a vendor sample (OD-3 remains the blocker for real data) | `packages/medication-terminology` | M |
| P2-7 | Gate 1 rerun on whatever catalog exists; Gate 2 golden set extended with reconciliation cases | validation | M |

**Exit gate (M2):** every medicine answers what/why/who/when started/when changed/when stopped from the API; duplicate/combination/class/multi-prescription checks pass the golden set; catalog adapter contract tests green.

---

## P3 — Document intelligence (weeks 10–22)

Detailed in [09](09-document-intelligence.md).

| WP | Work package | Size |
|---|---|---|
| P3-1 | Migration 8: `PatientDocument`, `DocumentPage`, `DocumentExtraction`, extended candidates; backfill from `PrescriptionDocument` | M |
| P3-2 | `packages/document-intelligence`: target schemas, confidence policy, adapters (OCR: Tesseract kept + vendor interface; AI: interface + contract checklist) | M |
| P3-3 | Worker queues `document_classify`, `document_extract`; AV scan adapter | M |
| P3-4 | OCR vendor evaluation against the Gate 5 corpus (OD-11) and AI provider legal + technical evaluation (OD-12) | M (decision) |
| P3-5 | patient-web: unified "Add document" flow (camera/gallery/file/share target), classification confirm, per-field candidate review with page highlight, materialize into prescription/report | L |
| P3-6 | Gate 5 and Gate 6 suites in CI (synthetic corpus committed; consented corpus in a private bucket for nightly) | M |

**Exit gate (M3):** zero paths from unconfirmed extraction to a confirmed row (asserted by tests); original object preserved for every document; classification accuracy reported per kind on the corpus; model provenance stored for every AI-assisted candidate.

---

## P4 — Tests and diagnostics (weeks 13–24)

| WP | Work package | Size |
|---|---|---|
| P4-1 | `packages/terminology` v1: analyte keys → LOINC + UCUM, unit conversion with tests, Gate 1b review items (T3 units, platelets lakhs, urea vs BUN) resolved by the Safety Board | M |
| P4-2 | Migration 9: `DiagnosticReport`, `DiagnosticResult`; backfill; V1 reports façade | M |
| P4-3 | API: diagnostic reports/results/trends ([05 §6](05-api-contracts-v2.md)) | M |
| P4-4 | patient-web: reports list by kind, structured result entry with unit picker and reference range, imaging report fields, trend charts per analyte (unit shown on every point, no client-side flags) | L |
| P4-5 | Extraction targets for lab values (P3 pipeline) with per-value confidence | M |

**Exit gate (M4):** trend for HbA1c/glucose/lipids/creatinine renders from structured results; unit safety tests green; no interpretation computed client-side (lint rule + review).

---

## P5 — In-home measurements (weeks 14–24)

| WP | Work package | Size |
|---|---|---|
| P5-1 | Migration 10: `Observation`, `MeasurementDevice`; backfill three tables + check-ups; V1 readings served from `Observation` | M |
| P5-2 | API: observations, batch, trends, devices | M |
| P5-3 | patient-web: one "Measurements" hub with per-concept diaries (BP, HR, glucose, weight, SpO2, temperature) and context capture; existing BP/weight/glucose screens migrated onto the hub | L |
| P5-4 | Trend analytics service (daily/weekly/monthly buckets, rolling average, high/low, AM/PM) with property-based tests | M |
| P5-5 | Device connector architecture: interfaces + Web Bluetooth prototype for one BP monitor; Apple Health / Health Connect deferred to native phases | M |

**Exit gate (M5):** every roadmap "initial measurement" concept is recordable with context, unit and provenance; three V1 tables have zero writes for one release; parity report `row_counts_match: true`.

---

## P6 — Caregiver and family platform (weeks 19–28)

| WP | Work package | Size |
|---|---|---|
| P6-1 | Migration 11: seven new scopes, `ConsentNotice`, consent versions | S |
| P6-2 | Scope-aware UI: buttons hidden/disabled per scope; server unchanged | M |
| P6-3 | Family dashboard (`GET profiles/current/family`), per-record "changed by" attribution, activity screen | M |
| P6-4 | Caregiver notification kinds (new prescription, new result, refill low; "unusual measurement" only behind a Safety-Board-approved rule) with per-kind channel/frequency controls | M |
| P6-5 | Step-up on caregiver management and scope changes | S |
| P6-6 | Gate 4 comprehension study includes caregiver flows | M |

**Exit gate (M6):** exhaustive authorization matrix test green including new scopes; caregiver e2e covers invite → scoped action → patient sees attribution → revoke.

---

## P7 — Secure sharing (weeks 21–30)

| WP | Work package | Size |
|---|---|---|
| P7-1 | Migration 12: sections, audience, peppered token hash | S |
| P7-2 | Doctor Snapshot service + PDF template + public snapshot route | M |
| P7-3 | patient-web share flow: WHAT / WHO / HOW LONG presets; document sharing with per-page signed URLs | M |
| P7-4 | Security review rerun for sharing (documents are new surface) | S |

**Exit gate (M7):** snapshot renders < 2 s for a 500-event profile; security review passed; old links never widen (regression test kept).

---

## P8 — ABDM sandbox integration (weeks 4–32, parallel)

Detailed in [08](08-abdm-fhir-integration.md). Milestones M8A (ABHA identity), M8B (PHR flows), M8C (FHIR interoperability), M8D (HIE-CM consent), M8E (sandbox exit readiness). Status category **Requires ABDM sandbox** applies until access is granted.

**Exit gate (M8E):** sandbox test evidence, FHIR conformance evidence, functional testing report, security assessment, undertakings, integration documentation, operational runbook — all filed under `docs_v2/validation/abdm/`.

---

## P9 — Clinical intelligence (weeks 25–40)

| WP | Work package | Size |
|---|---|---|
| P9-1 | Licensed catalog live (OD-3) → Gate 1 pass on ≥ 200 products incl. ≥ 50 FDCs | M |
| P9-2 | Interaction provider adapter (OD-4) behind `packages/clinical-rules`; findings light up only per Safety Board approval, category by category | M |
| P9-3 | Medicine-history comparison ("your dose changed from X to Y on …") as Observation-class insights | M |
| P9-4 | Gate 3 alert-quality dashboard (false-positive rate, acknowledgement rate) in admin | M |

**Exit gate (M9):** every finding explains why; Gate 1–3 signed; no "you should stop" wording anywhere (lint on copy keys + review).

---

## P10 — Treatment journey (weeks 28–40)

| WP | Work package | Size |
|---|---|---|
| P10-1 | `ClinicalRelationship` edges (condition ↔ medicine ↔ result ↔ observation ↔ provider) derived from links and confirmed by the patient where inferred | M |
| P10-2 | Before/after views ("Telmisartan started → BP 151/92 → 30 d 137/84 → 90 d 131/80") with explicit "shows a relationship, not a cause" copy reviewed at Gate 4 | M |
| P10-3 | Condition hub screen | M |

**Exit gate (M10):** relationships never assert causation (copy review); every inferred edge is patient-confirmable.

---

## P11 — Doctor and clinic platform (weeks 25–38)

| WP | Work package | Size |
|---|---|---|
| P11-1 | Migration 15: `User.userKind`, `OrganizationMember`, `ProviderPatientLink`, reconciliation tables | M |
| P11-2 | `apps/provider-web` scaffold with provider auth (phone OTP or email+TOTP), CSP, own Turnstile widget | M |
| P11-3 | QR patient onboarding (patient generates a time-boxed onboarding token; clinic scans) | M |
| P11-4 | Clinic workflow: snapshot → reconciliation proposal → patient accepts → visit summary; prescription capture; encounter proposal; follow-up reminders | L |
| P11-5 | Patient "Proposals" inbox | M |
| P11-6 | Security review + pen test scope includes provider-web | M |

**Exit gate (M11):** two pilot clinics complete the full workflow on staging with synthetic patients; every provider read audited with org id.

---

## P12 — Pharmacy (weeks 31–42)

`MedicationDispense`, refill prediction from dispenses, invoice attachment, pharmacy mode in provider-web, patient acceptance of dispense records. **Exit (M12):** refill reminder driven by dispense data for pilot patients.

## P13 — Laboratory integration (weeks 32–44)

Level 1 (exists) → Level 2 share/email intake (`share-target`, mailbox ingestion with sender allowlist) → Level 3 lab API adapter (one partner) → Level 4 ABDM diagnostic records. **Exit (M13):** one lab partner delivers structured results end-to-end into trends.

## P14 — Hospital discharge workflow (weeks 35–46)

Transition record: START / CONTINUE / CHANGE / STOP over `MedicationReconciliation`, discharge summary document, follow-up appointment, test requirements, prescriptions. **Exit (M14):** a synthetic admission → discharge scenario produces a correct transition record and the patient's passport reflects it after acceptance.

## P15 — Indian Patient Summary (month 12)

FHIR IG v7.x mapping in `packages/fhir` producing INPS from the canonical model; exported via `profiles/current/fhir/export?ig=7.0`. **Exit (M15):** INPS validates against the published profile; becomes part of the ABDM production pilot.

## P16 — Multilingual and voice (from month 4, parallel)

Locale architecture for ta/bn/mr/gu/kn/ml (dictionaries, fonts, audio manifest), professional translation and native review per locale before publishing (`PUBLISHED_LOCALES` gate), voice entry via Web Speech API producing proposals ("Blood pressure 128 over 76" → observation candidate) with mandatory confirmation. Hazard H-19 (translation changes clinical meaning) governs every locale release.

## P17 — Notifications and adherence (from month 4, parallel)

New kinds, per-kind channel/frequency controls, test-due schedules, WhatsApp via a BSP once contracted (OD-10), email channel, notification-overload guardrails (daily caps per kind, digest mode). Delivery remains never push-only (V1 rule).

## Pilot (months 12–13) and Scale (months 12–15)

[17-pilot-plan.md](17-pilot-plan.md) and [15-release-strategy.md](15-release-strategy.md) §V2.8–V2.9.

---

## Definition of done (every work package)

Code + tests per [13](13-verification-and-quality.md) · OpenAPI diff reviewed · migration + backfill + parity report where schema changed · provenance stamped and asserted · `HealthEvent` emitted where a clinical fact changed · audit events wired · hazard log reviewed · localization keys in all published locales with guidance audio where the screen speaks · axe/reflow green · status board [20](20-status-board.md) updated · demo against the phase acceptance criteria.
