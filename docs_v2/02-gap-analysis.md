# 02 — Gap Analysis: Roadmap Capability × Current State

Each row: what the roadmap asks for, what exists in the repository today (verified 2026-09-06, see [01](01-current-state-baseline.md)), the gap, and the V2 phase that owns closing it. "Exists" means shipped and tested in `apps/`/`packages/`; "Spec only" means it is in `docs/` but not in code.

Legend for the *State* column: **E** exists · **P** partial · **A** absent · **S** spec only.

## 1. Patient health record (Phase 1)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Demographics, contact, timezone | E | `PatientProfile` with IANA timezone, dependants, guardian attestation | Blood group, structured emergency contacts, height | P1 |
| Emergency contacts | P | `emergencyCard` Json | Normalize to rows, share on emergency card | P1 |
| Doctors | P | `Practitioner` patient-scoped free text, merge | Registration number, HPR id, organization link, global directory | P1, P8 |
| Facilities | A | `MedicalReport.facilityName` text only | `Organization` model, HFR id | P1 |
| Conditions | P | `PatientCondition` free-text label | Clinical status, onset/abatement, coding, encounter link | P1 |
| Allergies | E | `PatientAllergy` with ingredient link, severity | Category, reaction, criticality, coding | P1 |
| Intolerances, surgery history, family history | A | — | `Procedure`, `FamilyHistory`, allergy category | P1 |
| Immunizations | A | — | `Immunization` model + document link | P1 |
| Record metadata (author, source, verification, attachments, history) | P | `recordedByUserId` everywhere; `RecordSource` on 2 tables; instruction versions; `MedicationChange` | Provenance block on every clinical table; verification states | P0/P1 |
| Unified timeline | A | Timeline = today's dose slots (`TimelineDto`) | `HealthEvent` projection + timeline API + screen | P1 |
| Encounters (visit, admission, discharge) | A | `CheckupRecord` is the closest | `Encounter` model | P1 |

## 2. Medication and prescription platform (Phase 2)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Brand, generic, formulation, strength, dose, frequency, timing, food | E | `PatientMedication` + `MedicationInstruction` + catalog | Route and strength on the instruction, duration | P2 |
| Start/stop dates, status | E | statuses current/paused/completed/stopped/unknown, `statusChangedAt` | Planned stop date | P2 |
| Prescribing doctor, reason | P | via `Prescription.practitionerId`; `patientReason` text | Direct practitioner link; condition link | P2 |
| Prescription record with original image/PDF | E | `Prescription` + `PrescriptionDocument`, multi-page | `PrescriptionItem` line items, diagnosis, validity, follow-up, encounter | P2 |
| Medication history never overwritten | E | `supersededAt` instructions + `MedicationChange` | Extend change kinds for reconciliation | P2 |
| Reconciliation: exact/ingredient/combination/class duplicates, conflicting instructions | E | `safety-rules.ts` (6 checks) | Multiple-active-prescription check; reconciliation object for providers | P2, P11 |
| Drug interactions | A (Blocked OD-4) | categories declared, no data | Licensed provider adapter | P9 |
| Refill tracking | P | `quantityOnHand` counter, refill notification | `MedicationRefillPlan`, pack size, dispense link | P2, P12 |
| Adherence | E | `DoseEvent` append-only, 8 actions, offline | Weekly adherence summary events | P1 |

## 3. Document intelligence (Phase 3)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Sources: camera, gallery, PDF | E | presigned upload, magic-byte verify, quarantine | Share target (Web Share Target API), provider import, ABDM record | P3, P8 |
| Document types | P | 8 `DocumentKind` values | classifier + 6 more kinds | P3 |
| Malware/file validation | E | magic-byte + sha256 + quarantine | AV scan adapter (ClamAV or vendor) | P3 |
| Classification | A | user picks kind | model classifier with confidence, user override | P3 |
| OCR | P | Tesseract.js printed English + pdf text layer | Handwriting + Indic OCR provider (OD-11) | P3 |
| Clinical extraction | P | brand, frequency, food only; dose never read | Full target set (dose, strength, dates, practitioner, org, lab values) with confidence, bounding boxes | P3 |
| Normalization, confidence scoring, patient confirmation, original preserved | E | candidates confirm/reject, confidence, engine/version | Model provider/version/prompt fields, per-field source location | P3 |
| AI provider | A (Blocked OD-12) | none | Adapter + contract terms | P3 |

## 4. Tests and diagnostics (Phase 4)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Lab panels (CBC, HbA1c, glucose, KFT, LFT, lipids, thyroid, electrolytes, urine, vitamins) | P | 31-analyte closed vocabulary in `ReportValue` | LOINC mapping, units, reference ranges, flags, corrections, configurable additional tests | P4 |
| Diagnostics (ECG, echo, USG, X-ray, CT, MRI, pathology) | P | report kinds only | Modality, body site, impression, findings | P4 |
| Structured result fields (test, result, units, range, flag, specimen date, report date, lab, ordering doctor, original) | P | test, entered/numeric value, reference text, tested date | the rest | P4 |
| Trends | A | values listed verbatim | Trend endpoint per analyte with unit safety; charts | P4 |
| Relationship engine (result ↔ condition/medicine/prescription/encounter/provider) | A | — | `ClinicalRelationship` edges over `HealthEvent` | P10 |

## 5. Home measurements (Phase 5)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| BP, HR, glucose, weight | E | three tables (`BloodPressureReading` incl. pulse, `GlucoseReading`, `WeightReading`) | Unify into `Observation` | P5 |
| SpO2, temperature, respiratory rate, INR, peak flow, body composition, pain, insulin dose, fluids | A | — | `Observation` concepts | P5 |
| Context capture | P | 8 glucose contexts | General context enum, body site, method | P5 |
| Trend analytics (daily/weekly/monthly, rolling average, high/low, AM/PM) | A | — | trend service | P5 |
| Device integration (Bluetooth, Apple Health, Health Connect, CGM, scales, BP monitors, oximeters) | A | `UserDevice` is auth only | `MeasurementDevice`, connectors (native phases) | P5, native |

## 6. Caregiver and family (Phase 6)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Caregiver manages multiple members | E | relationships, invitations, profile switcher | Family dashboard screen | P6 |
| Granular permissions | E | 10 scopes | +7 scopes (tests, measurements, documents, manage caregivers) | P6 |
| Activity audit | E | `caregiver.access_used`, `GET caregivers/:id/accesses` | Per-record "changed by" attribution in UI | P6 |
| Caregiver notifications | P | missed-dose escalation, caregiver alerts | new prescription, new result, unusual measurement (validated rules only), refill low | P6, P17 |
| Scope-aware UI | P | server rejects; UI still shows buttons | hide/disable per scope | P6 |

## 7. Secure sharing (Phase 7)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Temporary URL, QR, PDF, WhatsApp text | E | `SharePackage`/`ShareLink`, worker PDF, `wa.me` | ABDM consent-based exchange | P7, P8 |
| Section choice | E | frozen `sections` | measurements, documents, conditions, encounters, full passport | P7 |
| Audience and duration presets | P | expiry ≤ 30 d custom | 15 m / 1 h / 24 h / 7 d presets; audience | P7 |
| Doctor Snapshot | P | visit summary sections | dedicated snapshot view with recent changes, 30-day measurements, relevant documents | P7 |
| Revocation and access log | E | immediate, every attempt logged | — | — |

## 8. ABDM (Phase 8)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| ABHA linking, number, address, profile | A | zero code; `docs/17` strategy | `AbhaLink`, M1/M2/M3 ABHA APIs | P8 M8A |
| Discovery, linking, fetch, view, store | A | — | HIU flows, `AbdmCareContext`, `AbdmDataBundle` | P8 M8B |
| FHIR R4 mapping and validation | S | `docs/17` mapping table; no `packages/domain/fhir` module exists | `packages/fhir` with versioned IG mapping (v6.5 / v7.x) | P8 M8C |
| HIE-CM consent | A | `Consent` is app-internal | `AbdmConsentArtefact`, consent notify/callback handlers | P8 M8D |
| Sandbox exit artifacts | A | — | evidence pack | P8 M8E |
| HIP/HIU roles | A | — | separate adapter service | P8+, gated by NHA |

## 9. Clinical intelligence and treatment journey (Phases 9–10)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Generic/ingredient normalization | E | catalog + `NormalizationStatus` | Licensed Indian catalog (OD-3) | P9 |
| Duplicate, combination, class detection | E | shipped | continuous Gate 3 monitoring | P9 |
| Known interactions | A (OD-4) | — | licensed adapter | P9 |
| Prescription conflict detection | P | dose-differs check | multi-prescription overlap | P9 |
| Explainability | E | every finding carries explanation + four statements | keep | — |
| Connected insights (condition ↔ meds ↔ labs ↔ measurements ↔ provider) | A | — | relationship engine, before/after visualizations without causal claims | P10 |

## 10. Provider products (Phases 11–14)

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Clinic portal | A | admin-web is internal ops only | `apps/provider-web`, provider auth, `ProviderPatientLink`, QR onboarding, reconciliation proposals, doctor summary, encounter capture | P11 |
| Pharmacy | A | — | dispense records, refill prediction, invoice attach | P12 |
| Lab integration L1–L4 | P | L1 upload exists | L2 share/email intake, L3 lab API, L4 ABDM | P13 |
| Hospital transition record | A | — | START/CONTINUE/CHANGE/STOP over reconciliation + discharge documents | P14 |
| HPR/HFR identity | A | — | via ABDM adapters | P8/P11 |

## 11. Platform, quality and operations

| Capability | State | Today | Gap | Phase |
|---|---|---|---|---|
| Indian Patient Summary | A | — | FHIR v7.x mapping | P15 |
| Languages | P | en/hi/te/ur (~790 keys) | ta/bn/mr/gu/kn/ml architecture + professional translation | P16 |
| Voice entry | A | read-aloud only (output) | speech input with mandatory confirmation | P16 |
| Notification channels | P | push, SMS (delivery platform-blocked), voice OTP | WhatsApp (BSP), email, per-kind frequency controls | P17 |
| Privacy/DPDP capabilities | P | consent records, erase-account, retention crons (partial) | notice versions, access/correction export, breach process, DPO (OD-9), data separation of analytics | P0+ |
| Security: step-up auth | A | none | `stepUpVerifiedAt`, OTP re-verify for sensitive ops | P0/P6 |
| Security: key rotation | S | single `FIELD_ENCRYPTION_KEY`, no key version column | keyring + `keyVersion` columns, rotation runbook executed | P0 |
| Security: API security headers | A | Cloudflare sets HSTS; Nest has no helmet/CSP | helmet + CSP at origin | P0 |
| Security: pen test | A | not done | external test before V2.4 | P8 |
| Admin platform | P | catalog, content, audit, incidents, operations, users, rules | providers, facilities, document status, support cases, consent audit, ABDM txns, FHIR failures, notification failures, flags | P1→P8 |
| Observability | P | pino logs, daily operational report cron | OTLP backend (OD-13), metrics, alerting, on-call | P0 |
| Analytics without PHI | P | Cloudflare Web Analytics (marketing only) | product metrics pipeline (events without PHI) | P1 |
| Quality: lint | A | no ESLint config; `pnpm lint` runs zero tasks | ESLint + jsx-a11y in CI | P0 |
| Quality: worker tests | A | `apps/worker` has zero tests | unit + integration for processors | P0 |
| Quality: contract tests | A | no OpenAPI spec | OpenAPI generation + pinning | P0 |
| Quality: FHIR conformance tests | A | — | validator suite per artifact | P8 |
| Quality: security/authz matrix test | S | ad hoc IDOR tests | exhaustive endpoint × role × scope | P0 |
| Quality: DR drill | P | monthly restore-test cron | region-loss game day | P0/ops |
| Deploy gates | P | Railway auto-deploys `foundation` with `checkSuites: false` | CI-gated deploys, staging project, rollback rehearsal | P0 |
| Local dev on Windows | P | api test script and worker helper were POSIX-only (fixed 2026-09-06) | keep portable | P0 |

## 12. Biggest structural gaps (in priority order)

1. **Provenance everywhere** — without it, O9 and every ABDM export are impossible. Phase 0/1, additive migration.
2. **Organization, Encounter, HealthEvent** — three greenfield tables that most later phases hang off.
3. **Observation and DiagnosticReport/Result unification** — replaces four lookalike tables and the 31-analyte text column; unblocks SpO2, temperature, trends, LOINC.
4. **`packages/fhir` + `packages/terminology`** — do not exist despite `docs/17` saying the mapping module lives in `packages/domain/fhir`.
5. **Document model** — `PrescriptionDocument` cannot represent multi-owner, multi-page, classified documents with page-level extraction provenance.
6. **Quality infrastructure** — no lint, no worker tests, no OpenAPI, deploys not gated by CI. These are Phase 0 because everything after gets cheaper.
