# 17 — FHIR and ABDM Strategy

Stance (spec §17): the internal model is **FHIR R4-compatible** where appropriate, so future interoperability is a mapping exercise, not a re-architecture. **ABHA/ABDM registration is never required for initial use**; ABDM is a later interoperability capability aligned with ABDM policy principles (consent-driven exchange, purpose limitation, patient control).

## Internal → FHIR R4 mapping

Implemented as a pure mapping module (`packages/domain/fhir`), used by export/import features — the internal schema stays product-shaped.

| Internal entity ([13](13-data-model.md)) | FHIR R4 resource | Notes |
|---|---|---|
| `patient_profiles` | `Patient` | Opaque IDs; phone as telecom on linked `users` |
| `caregiver_relationships` | `RelatedPerson` | Scopes have no FHIR equivalent — represented via `Consent` provisions |
| `practitioners` | `Practitioner` | Patient-entered in MVP; unverified flagged via `Provenance` |
| `organizations` | `Organization` | |
| `medication_products` (+ingredients/strengths) | `Medication` | Ingredients as `Medication.ingredient`; FDCs = multiple ingredients; codes from catalog source (RxNorm where mappable, else local CodeSystem) |
| `prescriptions` + `medication_instructions` | `MedicationRequest` | `dosageInstruction` encodes typed frequency/timing/food (`when` codes: `ACM`,`PCV`… mapped from our slots); original text in `dosageInstruction.text` |
| `patient_medications` (current state incl. patient-reported) | `MedicationStatement` | Status map: current→active, paused→on-hold, completed→completed, stopped→stopped, unknown→unknown; `reasonCode.text` = patient-specific reason (patient-reported provenance) |
| `dose_events` | `MedicationAdministration` (export detail level) | Optional in exports |
| `patient_allergies` | `AllergyIntolerance` | Patient-reported criticality preserved |
| `patient_conditions` | `Condition` | |
| `prescription_documents` / `stored_objects` | `DocumentReference` | Content by reference through authorized download URLs only — never public R2 URLs |
| `medication_schedules` | `CarePlan` (activity schedule) | Tapers carry `taperSource` provenance |
| original vs confirmed values, confirmer identity, OCR engine/version | `Provenance` | Every mapped resource carries Provenance: who recorded/confirmed, when, from what source, which software version |
| `consents` / `consent_events` | `Consent` | Purpose-bound provisions; caregiver scopes as provision actors |

Export bundles: `Bundle (type=collection)` for data export; doctor-visit summary can later emit an ABDM-compatible document artifact.

## ABDM roadmap (post-MVP, ADR-gated)

| Step | Capability | Precondition |
|---|---|---|
| A1 | ABHA linking (optional, patient-initiated) | ABDM sandbox onboarding as HIU/HIP evaluated; DPDP alignment review |
| A2 | Act as **HIU**: import prescriptions/discharge summaries via ABDM consent artefacts | A1 + consent-manager integration; imported records enter the normal confirmation pipeline (never auto-confirmed) |
| A3 | Act as **HIP**: expose patient-held medication statements | Clinical governance sign-off; FHIR profiles per NRCES/ABDM (India) specs |

ABDM consent artefacts map onto our `consents` model (purpose codes, expiry, revocation) — the internal consent framework is designed to be a superset. All ABDM work runs on Railway; the gateway integration is a provider adapter in `packages/notifications`-style pattern (own package when built).

## Import policy

Any future FHIR/ABDM import (spec §14.2) is treated exactly like OCR: candidate values with source provenance → patient confirmation → confirmed records. External data never bypasses the confirmation and safety-evaluation pipeline.

## Status

Everything here is **Deferred (post-MVP)** except: internal model FHIR-compatibility (shipped with the schema), the mapping-module skeleton (`packages/domain`), and export-bundle generation (Stage 7/8). Open decisions OD-8 (ABDM onboarding timing) tracked in [24](24-open-decisions-and-assumptions.md).
