# 08 — ABDM and FHIR Integration Plan

Supersedes `docs/17-fhir-and-abdm-strategy.md` (whose mapping table is carried forward in §6). ABDM is a program-level workstream (WS09) that starts in Phase 0 and runs in parallel with product phases; the consumer product never waits for it, and ABHA is never required for use.

## 1. Roles and sequencing

| Role | What it means for us | When |
|---|---|---|
| A — ABDM-enabled PHR application | ABHA create/link/authenticate, discover, link care contexts, fetch and view records, request/grant/revoke consent, health-locker storage | V2.4 beta (sandbox), V2.8 production |
| B — Health locker | store patient-authorized copies and uploaded historical documents | same as A; storage already exists (R2 + `PatientDocument`) |
| C — HIP | expose MedicinePassport-originated eligible records (patient-generated wellness, measurements, structured documents, provider-product records) | after NHA confirms scope during sandbox; not assumed |
| D — HIU | provider products consume patient-authorized records | V2.8+ with the clinic product |

Roles C/D live in `apps/abdm-gateway` behind separate feature flags and are certified separately from Role A.

## 2. Versioned FHIR compatibility layer

Facts to plan around (roadmap §5, as of August 2026): NRCeS publishes the ABDM FHIR IG; **v6.5.0** is the current published version; a **v7.0.0 active preview** (July 2026) adds the Indian Patient Summary and additional vital-sign profiles. The production version must always follow what the sandbox/production certification requires at the time.

```
Canonical model (Prisma rows)
        │
   packages/fhir
   ├── canonical/           typed canonical DTOs (from packages/domain)
   ├── ig/v6_5/             serializer + profile validator + terminology bindings
   ├── ig/v7_0/             same, incl. INPS + vital-sign profiles
   ├── version-mapper.ts    selects IG by env/pin; can emit both for diff tests
   ├── parser/              FHIR → canonical candidates (inbound)
   ├── validator/           structural + profile + terminology validation
   └── conformance/         test harness: fixtures per artifact, run in CI
```

Rules:
- `packages/fhir/IG-VERSIONS.md` pins the IG version(s) built, with the NRCeS URL and the date verified.
- The API never imports `ig/*` directly; it calls `serialize(entity, {ig})` and `validate(bundle, {ig})`.
- Adding a new IG version is a new folder plus fixtures; nothing else changes (ADR-V2-003).
- The FHIR base version is R4 for both IGs; if NRCeS moves to R4B/R5, that becomes another folder.

## 3. Terminology layer (`packages/terminology`)

Versioned JSON tables + pure functions. No network at runtime.

| Domain | Systems | Source of truth in repo |
|---|---|---|
| Lab analytes | LOINC (code, display), UCUM units, canonical unit | `analytes.v1.json` — starts from the V1 31-analyte vocabulary, Gate 1b reviewed |
| Vital signs | LOINC vital-sign codes per `ObservationConcept` | `observation-concepts.v1.json` |
| Conditions | SNOMED CT (ABDM-required) + ICD-10 crosswalk where available | `conditions.v1.json` (starter set, extended by usage) |
| Allergies | SNOMED CT substance codes; ingredient link to catalog | `allergies.v1.json` |
| Medications | catalog ingredient/product → RxNorm where mappable else local CodeSystem `https://medicinepassport.app/CodeSystem/medication` | generated from `packages/medication-terminology` at build |
| Document types | ABDM `HealthDocumentRecord` type codes, LOINC document codes | `document-types.v1.json` |
| Encounter classes | HL7 v3 ActCode | static |

Licensing note: SNOMED CT is free in India via the NRCeS national release centre for Indian affiliates; LOINC is free with attribution; RxNorm free (RxNorm-native content only). The register in `infra/vendor-register.md` gains rows for each.

## 4. `apps/abdm-gateway`

Separate NestJS service (own Railway service, own hostname `abdm.medicinepassport.app`, own secrets). Responsibilities:

- Holds gateway client id/secret, HIU/HIP ids, the RSA/ECDH key pairs used for health-information encryption, and the callback-URL registration.
- Exposes only the ABDM callback routes and an internal, mTLS-or-token-authenticated `/internal/*` API used by `apps/api` (private Railway networking).
- Every inbound callback is verified (gateway JWT), persisted as `AbdmTransaction`, and enqueued; the handler returns 202 within the gateway's timeout.
- Outbound calls go through a single client with retry/backoff, correlation id, and a per-call `AbdmTransaction` row.
- Decrypts incoming `health-information/transfer` payloads, stores the raw encrypted payload in R2 bucket `abdm-inbox` (never in Postgres), and records `AbdmDataBundle`.

Certification scope is therefore this service + the parts of `apps/api` that call it, which keeps the sandbox functional test focused.

## 5. Milestones

### M8A — ABHA identity (months 4–5)
Sandbox flows for ABHA creation/verification (Aadhaar OTP, mobile OTP, ABHA number/address login), profile retrieval, and linking to a `PatientProfile` (`AbhaLink`). Exit: link/unlink/re-link e2e on sandbox with recorded transactions; ABHA number stored encrypted with a digest index; UI shows "ABHA: Connected" on Home.

### M8B — PHR integration (month 6)
Discovery (`patients/find`), care-context linking (init/confirm with OTP), health-information request via consent, receive and store bundles, view in the app. Exit: a sandbox HIP's records appear as candidates in the patient's confirmation queue with `source = abdm_imported`; confirmed rows carry `sourceAbdmTxnId`.

### M8C — FHIR interoperability (month 7)
Mapping and validation for the priority artifacts (§6). Exit: conformance suite green for all sixteen priority artifacts on IG v6.5; v7.0 preview fixtures pass for the vital-sign profiles; outbound export of the patient's own data validates.

### M8D — HIE-CM consent (months 7–8)
Consent request creation (for HIU flows), consent notification handling, grant/deny/revoke, expiry and data-erase timers honoured (`AbdmConsentArtefact.dataEraseAt` triggers deletion of the bundle copy, never of patient-confirmed rows, which are the patient's own record — legal review to confirm this position, tracked in [16](16-dependencies-and-risks.md) D-ABDM-2). Exit: consent lifecycle e2e on sandbox; the app shows ABDM consents on a separate screen from MedicinePassport shares.

### M8E — Sandbox exit readiness (months 8–9)
Evidence pack under `docs_v2/validation/abdm/`: sandbox test evidence (transaction logs), FHIR conformance evidence (CI reports), functional testing report per NHA template, security assessment (external, covering gateway + api + provider-web), undertakings, integration documentation, operational runbook (key rotation, callback outage, gateway downtime, consent-expiry job failure). Exit: NHA functional test passed; production credentials issued.

## 6. Artifact mapping (priority order = M8C order)

| # | MedicinePassport | ABDM/FHIR artifact | Canonical source | Notes |
|---|---|---|---|---|
| 1 | Prescription | `PrescriptionRecord` (Bundle/Composition) | `Prescription` + `PrescriptionItem` + `Practitioner` + `Organization` | original document as `DocumentReference` inside the bundle |
| 2 | Medicine (catalog) | `Medication` | `MedicationProduct` + ingredients | RxNorm or local CodeSystem |
| 3 | Medication order | `MedicationRequest` | `PrescriptionItem` + `MedicationInstruction` | `dosageInstruction.timing.repeat.when` from slots; text preserved |
| 4 | Patient-reported medication | `MedicationStatement` | `PatientMedication` | status map current→active, paused→on-hold, completed, stopped, unknown; `informationSource` = Patient; Provenance says patient-reported |
| 5 | Lab report | `DiagnosticReportRecord` / `DiagnosticReportLab` | `DiagnosticReport` kind=laboratory + results | |
| 6 | Individual lab result | `Observation` (lab) | `DiagnosticResult` | LOINC + UCUM required at this boundary; rows without mapping are exported as `Observation` with local code + text and flagged in `FhirValidationFailure` |
| 7 | Imaging report | `DiagnosticReportImaging` | `DiagnosticReport` kind=imaging | modality, body site |
| 8 | Wellness data | `WellnessRecord` | `Observation` (non-vital concepts) | |
| 9 | Blood pressure | `ObservationBP` (v7 vital-sign profile) | `Observation` concept=blood_pressure | components systolic/diastolic |
| 10 | Weight | `ObservationBodyWeight` | concept=body_weight | |
| 11 | Heart rate | `ObservationHeartRate` | concept=heart_rate | |
| 12 | Oxygen saturation | `ObservationOxygenSat` | concept=spo2 | |
| 13 | Condition | `Condition` | `PatientCondition` | SNOMED CT |
| 14 | Allergy | `AllergyIntolerance` | `PatientAllergy` | criticality, category |
| 15 | Medical document | `HealthDocumentRecord` / `DocumentReference` | `PatientDocument` + pages | content by authorized reference; never public R2 URLs |
| 16 | Provenance | `Provenance` per resource | provenance block | who/when/source/software version; refuses to export rows without provenance |

Later: `Encounter`, `Immunization` (`ImmunizationRecord`), discharge summary (`DischargeSummaryRecord`), `Procedure`, `Device`/`DeviceUseStatement` for device-recorded observations, `Practitioner`/`PractitionerRole` with HPR id, `Organization` with HFR id, `Consent`, and the **Indian Patient Summary** (v7.x) composed of identity, medicines, allergies, conditions, procedures, major history, important results.

## 7. Import policy (unchanged from V1, now enforceable)

Every inbound bundle → `parser` → `ExtractionCandidate` rows (`targetEntity` per resource, `source = abdm_imported`) → patient confirmation → canonical rows with `verification = source_authenticated` and `sourceAbdmTxnId`. Safety evaluation runs after confirmation exactly as for manual entry. A test asserts no code path writes clinical tables from `AbdmDataBundle` directly.

## 8. Indian Patient Summary (Phase 15)

Composed from canonical rows via `ig/v7_0/ips.ts`; sections limited to what the patient has confirmed; every entry carries Provenance; export requires step-up and is audited; used for the Travel Medicine Passport later.

## 9. Sandbox and environment strategy

| Environment | Gateway env | Credentials | Data |
|---|---|---|---|
| local | mock gateway (`apps/abdm-gateway` `MOCK=true` with recorded fixtures) | none | synthetic |
| staging (`medpass-stg`) | ABDM sandbox | sandbox client | synthetic ABHA test identities only |
| production | ABDM production (after M8E) | production client | real |

The mock gateway replays recorded sandbox transactions so CI can run the full flow without network.

## 10. Observability and admin

`AbdmTransaction` feeds `admin/abdm/transactions` (status, error codes, latency); `FhirValidationFailure` feeds `admin/fhir/validation-failures`; alerts on callback verification failures, consent-expiry job failures, and gateway error-rate > 5 % over 15 min ([14](14-observability-and-operations.md)). Every ABDM exchange carries our `correlationId` **and** the ABDM `requestId`/`transactionId` (roadmap §32).

## 11. Open questions for NHA/sandbox (tracked as D-ABDM-*)

1. HIP scope for patient-generated records (Role C).
2. Data-erase semantics for records the patient has confirmed into their own PHR (M8D).
3. Which IG version the sandbox functional test will require at our test date.
4. Whether a third-party PHR app may also act as HIU for its own provider product under one registration.
