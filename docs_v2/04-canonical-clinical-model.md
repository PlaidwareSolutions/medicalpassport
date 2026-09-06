# 04 — Canonical Clinical Data Model (V2)

This is the Prisma-level design for the V2 longitudinal record. It is written against the **actual** V1 schema (`packages/database/prisma/schema.prisma`, 63 models, 56 enums, 39 migrations as of 2026-09-06), not against the V1 planning doc. Every section says what exists today, what changes, and which migration lands it.

Design rules (from the roadmap §3, §9 and ADR-V2-001..004):

1. **The database is not a FHIR store.** We keep a product-shaped canonical model and map to FHIR at the edge (see [08-abdm-fhir-integration.md](08-abdm-fhir-integration.md)).
2. **Every clinical row carries provenance** (`source`, `verification`, `recordedByUserId`, `recordedVia`, optional `sourceDocumentId`, `sourceExtractionId`, `sourceDeviceId`, `sourceAbdmTransactionId`). Never present patient-entered or OCR-extracted data as provider-authenticated.
3. **Originals are immutable; corrections are new rows.** Entered value and normalized value are always separate columns. History is append-only.
4. **Coded where a code exists, text always preserved.** Codes are optional in V2.0 and become required at the FHIR boundary only.
5. **One timeline.** Every clinical fact emits a `health_event` row so the patient's history can be reconstructed chronologically from one table.
6. **Additive migrations only until V2.4.** No V1 table is dropped or renamed before the ABDM beta; V1 tables that are superseded are backfilled into the new shape and kept read-only behind a feature flag until the sunset migration (tracked in [20-status-board.md](20-status-board.md)).

---

## 1. Provenance — the cross-cutting change

### 1.1 Today

Only `PatientAllergy` and `PatientCondition` carry `RecordSource` (patient/document/professional). `MedicationProduct` has catalog provenance (`sourceName`/`sourceVersion`). `ExtractionCandidate` has `confidence` and engine/version on `PrescriptionExtraction`. Nothing else records where a value came from or how trusted it is.

### 1.2 V2 provenance block

Add these columns to every patient-clinical table (list in §1.3). Implemented as a Prisma composite pattern repeated per model (Prisma has no mixins; a generator script `packages/database/scripts/check-provenance.ts` fails CI if a listed model lacks any column).

| Column | Type | Meaning |
|---|---|---|
| `source` | `RecordSource` (extended enum) | `user_entered`, `caregiver_entered`, `ocr_extracted`, `clinic_entered`, `lab_imported`, `pharmacy_entered`, `device_recorded`, `abdm_imported`, `system_derived` |
| `verification` | `VerificationState` | `unverified`, `patient_confirmed`, `provider_verified`, `source_authenticated` |
| `recordedByUserId` | uuid? | Who pressed save (already exists on most V1 tables) |
| `recordedVia` | text | `pwa`, `native_android`, `native_ios`, `clinic_portal`, `pharmacy_portal`, `lab_api`, `abdm`, `worker` |
| `sourceDocumentId` | uuid? → `PatientDocument` | When derived from a document |
| `sourceExtractionId` | uuid? → `DocumentExtraction` | When derived from OCR/AI |
| `sourceDeviceId` | uuid? → `MeasurementDevice` | When device-recorded |
| `sourceAbdmTxnId` | uuid? → `AbdmTransaction` | When fetched via ABDM |
| `sourceOrganizationId` | uuid? → `Organization` | Facility that produced it |
| `sourcePractitionerId` | uuid? → `Practitioner` | Clinician that produced it |
| `verifiedByUserId` / `verifiedAt` | uuid? / timestamptz? | Who moved it to `provider_verified` |

Rules:
- `verification` can only move **up** (`unverified` → `patient_confirmed` → `provider_verified` → `source_authenticated`) and only by an actor entitled to the target state (patients can reach `patient_confirmed`; verified HPR practitioners `provider_verified`; ABDM/lab-API imports arrive as `source_authenticated`). Enforced in `packages/domain/src/provenance.ts` and covered by unit tests.
- Existing V1 rows are backfilled: `source = user_entered` (or `ocr_extracted` where `PatientMedication.source = extraction`), `verification = patient_confirmed` where a V1 confirm timestamp exists, else `unverified`.
- The `RecordSource` enum is extended, not replaced. V1 values `patient`/`document`/`professional` are mapped in the backfill migration and then removed from the enum in the sunset migration.

### 1.3 Tables that get the provenance block

`PatientMedication`, `MedicationInstruction`, `Prescription`, `PatientAllergy`, `PatientCondition`, `Observation` (new), `DiagnosticReport` (new), `DiagnosticResult` (new), `Encounter` (new), `PatientDocument` (new), `Immunization` (new), `Procedure` (new), `CheckupRecord` (until sunset), `MedicalReport` (until sunset), `ReportValue` (until sunset), `GlucoseReading`/`BloodPressureReading`/`WeightReading` (until sunset).

Migration: `2026MMDD_v2_provenance_columns` (additive, nullable, followed by a backfill script and a second migration making `source` and `verification` NOT NULL with defaults).

---

## 2. Identity and care relationships

### 2.1 Existing (kept)

`User`, `UserDevice`, `Session`, `OtpAttempt`, `PatientProfile` (with `timezone`, dependants via `dependentRelationship` + guardian attestation + claim invites), `CaregiverRelationship` + `CaregiverPermission` (10 scopes), `Consent` + `ConsentEvent`.

### 2.2 Changes

**`CaregiverScope` enum** grows to match the roadmap permission list (Phase 6). Additions: `view_tests`, `upload_tests`, `view_measurements`, `add_measurements`, `view_documents`, `upload_documents`, `manage_caregivers`. Existing 10 values stay. `full_management` implies all. Authorization matrix in `packages/authorization` is regenerated from the enum and unit-tested exhaustively (every scope × every action).

**`Consent`** gets `purposeVersion int`, `noticeVersion text`, `collectedVia text`, `expiresAt` already exists. A `ConsentNotice` table (id, version, locale, bodyHash, publishedAt) records the exact notice text shown, so DPDP "what did the patient agree to" is answerable. ABDM consent artefacts live in a **separate** table (`AbdmConsentArtefact`, §8) and are never merged into `Consent` (roadmap §16 "do not silently equate them").

**`AbhaLink`** (new, §8) hangs off `PatientProfile`, optional, one active per profile.

**Step-up authentication**: add `Session.stepUpVerifiedAt timestamptz?`; sensitive endpoints require it within the last 10 minutes (see [11-security-privacy-compliance.md](11-security-privacy-compliance.md)).

---

## 3. Organizations, practitioners, encounters (new)

### 3.1 `Organization`
Facilities and provider organizations. Patient-scoped in V2.0 (patients can add "Apollo Clinic, Jubilee Hills"), global directory entries from V2.6 (clinic product) and HFR-linked from V2.4.

| Field | Notes |
|---|---|
| `id`, `patientProfileId?` | null = global directory entry |
| `kind` `OrganizationKind` | `clinic`, `hospital`, `laboratory`, `pharmacy`, `diagnostic_centre`, `other` |
| `displayName`, `addressText`, `city`, `state`, `pincode`, `phoneCiphertext?` | |
| `hfrId?` (unique) | ABDM Health Facility Registry id, verified only via ABDM |
| `verification` | provenance block |
| `mergedIntoId?` | patient merge (mirrors `Practitioner.merge`) |

### 3.2 `Practitioner` (extend)
Today: patient-scoped `displayName` + `speciality`. Add `registrationNumber?`, `registrationCouncil?`, `hprId?` (unique, ABDM Health Professional Registry), `organizationId?`, `userId?` (when the practitioner is also a clinic-portal user, V2.6), `verification`. Keep patient scoping; global directory rows have `patientProfileId = null`.

### 3.3 `Encounter`
One visit/admission that ties documents, prescriptions, results and observations together.

| Field | Notes |
|---|---|
| `patientProfileId`, `kind` `EncounterKind` (`outpatient`, `inpatient`, `emergency`, `teleconsult`, `pharmacy`, `lab_visit`, `home`) | |
| `startedAt` date/time, `endedAt?` | inpatient uses both |
| `organizationId?`, `practitionerId?` | |
| `reasonText?`, `diagnosisText?` | plus optional `diagnosisCode` table rows |
| `dischargeSummaryDocumentId?` | Phase 14 |
| provenance block, `deletedAt`, `rowVersion` | |

`Prescription.encounterId?`, `DiagnosticReport.encounterId?`, `PatientDocument.encounterId?`, `Observation.encounterId?` are nullable FKs. Encounters are optional in V2.0 UI; they become first-class in V2.6/V2.7.

---

## 4. Medication platform (extend, do not replace)

V1 already has the strongest part of the model: `PatientMedication` (entered vs normalized), versioned `MedicationInstruction` (`supersededAt`), append-only `MedicationChange`, `MedicationSchedule` → `ScheduledDose` → `DoseEvent`, `Prescription`.

### 4.1 Changes

| Change | Why |
|---|---|
| `MedicationInstruction.route AdministrationRoute?`, `strengthLabel`, `durationDays?`, `stopPlannedAt?` | Roadmap M2 fields (route, strength, duration) |
| `PatientMedication.reasonConditionId? → PatientCondition` | "why am I taking it" as a link, not only text (`patientReason` stays) |
| `PatientMedication.prescribingPractitionerId?` | today only via `Prescription.practitionerId` |
| `MedicationChange.changeKind` extended: `started`, `dose_changed`, `frequency_changed`, `paused`, `resumed`, `stopped`, `completed`, `reconciled_continue`, `reconciled_stop`, `reconciled_change` | Phase 11/14 reconciliation transitions are recorded as changes with `sourceOrganizationId` |
| `MedicationDispense` (new) | Pharmacy product (Phase 12): `patientMedicationId`, `organizationId`, `dispensedAt`, `quantity`, `unit`, `daysSupply?`, `lotNumber?`, `expiryDate?`, `invoiceDocumentId?`, provenance |
| `MedicationRefillPlan` (new) | Replaces the bare `quantityOnHand` counter: `packSize`, `quantityOnHand`, `dailyConsumption` (derived), `projectedRunOutOn`, `lastDispenseId?`. `quantityOnHand` on `PatientMedication` is kept in sync until sunset |
| `Prescription.status` | already draft→confirmed; add `superseded` for re-issued prescriptions, `encounterId?`, `validUntil?`, `followUpOn?`, `diagnosisText?` |
| `PrescriptionItem` (new) | Line items as written on the prescription, separate from the patient's current `PatientMedication`. A prescription line can be "prescribed but never started". V1 links medicines directly to prescriptions; the backfill creates one item per linked medicine |

### 4.2 Reconciliation output
`MedicationReconciliation` (new, Phase 11/14): `patientProfileId`, `encounterId?`, `performedByUserId`, `performedAt`, `organizationId?`, `status` (`draft`, `proposed`, `patient_accepted`, `patient_rejected`, `applied`), and `MedicationReconciliationLine` rows (`patientMedicationId?`, `prescriptionItemId?`, `decision` `continue|stop|change|add`, `proposedInstructionJson`, `reasonText`). Applying a reconciliation writes `MedicationChange` rows with `changeKind = reconciled_*`. A clinic can only **propose**; the patient (or caregiver with `edit_medications`) accepts (roadmap §30: AI/provider never silently changes authoritative data — same rule for providers).

---

## 5. Observations (home measurements and vitals) — unify

### 5.1 Today
Three sibling tables (`GlucoseReading`, `BloodPressureReading` incl. pulse, `WeightReading`) plus `CheckupRecord` with embedded duplicate columns, explicitly never synced. No SpO2, temperature, heart rate, height, respiratory rate.

### 5.2 `Observation` (new, generic)

| Field | Notes |
|---|---|
| `id`, `patientProfileId`, `encounterId?` | |
| `concept` `ObservationConcept` | `blood_pressure`, `heart_rate`, `blood_glucose`, `body_weight`, `body_height`, `bmi`, `spo2`, `body_temperature`, `respiratory_rate`, `inr`, `peak_flow`, `pain_score`, `insulin_dose`, `fluid_intake`, `fluid_output`, `waist_circumference`, `steps`, `sleep_hours`, `other` |
| `conceptCode?` (LOINC), `conceptSystem?` | filled by the terminology layer, not by the client |
| `valueNumeric Decimal?`, `valueNumeric2 Decimal?` | BP uses both (systolic/diastolic); everything else uses one |
| `valueText?` | for `other` and free text |
| `unit` text | canonical unit per concept enforced by `packages/domain/src/observation-units.ts` (mmHg, bpm, mg/dL, kg, cm, %, °C, /min, ratio, L/min, 0–10, IU, mL) |
| `enteredUnit?`, `enteredValueText` | what the user typed, immutable |
| `context` `ObservationContext?` | extends the 8 glucose contexts with `resting`, `post_exercise`, `sitting`, `standing`, `lying`, `morning`, `evening`, `fasting`, `random` |
| `bodySite?`, `method?` | e.g. left arm, fingerstick |
| `measuredAt` timestamptz, `measuredAtLocal` text (ISO local in patient tz) | the clinical time in the patient's zone (V1 rule kept) |
| `interpretation?` `ObservationInterpretation` | `normal`, `high`, `low`, `critical_high`, `critical_low`, `abnormal` — **only** set for provider/lab-sourced data or by a clinically approved rule (Phase 9); never by client code |
| `notes?` | |
| provenance block (`sourceDeviceId` matters here), `recordedByUserId`, `deletedAt`, `rowVersion`, `clientMutationId?` (offline) | |

Constraints: unique `(patientProfileId, concept, measuredAt, sourceDeviceId)` partial to dedupe device syncs; check constraint per concept on value ranges (plausibility only, e.g. SpO2 0–100, never a clinical threshold).

### 5.3 Backfill and sunset
Migration `v2_observations` creates the table; a backfill job copies the three V1 tables + `CheckupRecord` metrics into `Observation` with `source = user_entered`, keeping the V1 primary key in `legacyId`. The API serves both shapes until patient-web V2.2 ships; V1 endpoints then become read-only, and the sunset migration drops the three tables after one release with zero V1 writes (verified via audit).

### 5.4 `MeasurementDevice` (new, Phase 5)
`patientProfileId`, `kind` (`bp_monitor`, `glucometer`, `cgm`, `smart_scale`, `pulse_oximeter`, `thermometer`, `wearable`, `phone_health_platform`), `manufacturer?`, `model?`, `serialDigest?`, `platform` (`bluetooth`, `apple_health`, `health_connect`, `vendor_api`, `manual`), `lastSyncAt?`, `status`. Device-recorded observations carry `sourceDeviceId`, giving `Device`/`DeviceUseStatement` at the FHIR boundary.

---

## 6. Diagnostics — labs and imaging

### 6.1 Today
`MedicalReport` (7 kinds, `facilityName` text, `testedAt`) + `ReportValue` (closed 31-analyte vocabulary, text analyte column, entered/numeric value, `referenceText` display-only, no units, no flags, no update path).

### 6.2 `DiagnosticReport` (new; replaces `MedicalReport`)

| Field | Notes |
|---|---|
| `patientProfileId`, `encounterId?`, `kind` `DiagnosticReportKind` | `laboratory`, `imaging`, `ecg`, `echo`, `pathology`, `microbiology`, `genetics`, `other` |
| `category` text? | e.g. haematology, biochemistry (lab-provided) |
| `title` | "Lipid profile", "Chest X-ray PA" |
| `specimenCollectedAt?`, `reportedAt?`, `testedAt` (V1 field, kept as the display date) | roadmap M4 dates |
| `organizationId?` (lab), `facilityNameText` (V1 free text kept), `orderingPractitionerId?`, `reportingPractitionerId?` | |
| `modality?` `ImagingModality` (`xray`, `ct`, `mri`, `ultrasound`, `mammography`, `pet`, `nuclear`, `other`), `bodySite?`, `impressionText?`, `findingsText?` | imaging fields |
| `status` `DiagnosticReportStatus` (`registered`, `partial`, `final`, `amended`, `cancelled`) | |
| `conclusionText?` | |
| provenance block, `deletedAt`, `rowVersion` | |

Documents attach via `PatientDocument.diagnosticReportId` (multi-page; §7).

### 6.3 `DiagnosticResult` (new; replaces `ReportValue`)

| Field | Notes |
|---|---|
| `diagnosticReportId`, `patientProfileId` (denormalized for row-level scoping) | |
| `analyteKey` text | the V1 closed vocabulary key kept as the stable product key (`hba1c`, `fasting_glucose`, …), extended by the terminology layer; unknown analytes allowed with `analyteKey = other` + `analyteLabelText` |
| `loincCode?` | mapped by `packages/terminology` |
| `enteredValueText` (immutable), `valueNumeric?`, `valueText?`, `comparator?` (`<`, `>`, `<=`, `>=`) | |
| `unit?` (canonical), `enteredUnit?` | UCUM where mappable |
| `referenceLow?`, `referenceHigh?`, `referenceText?` | structured range plus the lab's text |
| `interpretation?` | same enum as Observation; set only from the lab's own flag or a provider |
| `specimenType?` | |
| `sequence int` | order on the report |
| provenance block (`sourceExtractionId` when OCR-derived), `recordedByUserId`, `supersededById?` | corrections create a new row and point the old one at it |

### 6.4 Trend rule
Trends (Phase 4 "HbA1c Jan 8.8 → Apr 8.1 → Aug 7.3") are computed from `DiagnosticResult` by `analyteKey`/`loincCode` and unit. Cross-unit series are never merged silently; unit conversion is a terminology-layer function with tests, and the UI shows the unit on every point.

---

## 7. Documents — multi-page, polymorphic, preserved

### 7.1 Today
`StoredObject` + `PrescriptionDocument` (misnamed; owns a prescription OR a report OR nothing, single object per document) + `PrescriptionExtraction`/`ExtractionCandidate` with a 3-value `ExtractionField` enum.

### 7.2 `PatientDocument` (new; replaces `PrescriptionDocument`)

| Field | Notes |
|---|---|
| `patientProfileId`, `kind` `DocumentKind` (V1 8 values + `consultation_note`, `vaccination_record`, `referral`, `insurance`, `invoice`, `imaging_film`) | |
| `title?`, `documentDate?` | date on the document, distinct from upload date |
| `prescriptionId?`, `diagnosticReportId?`, `encounterId?`, `immunizationId?`, `dischargeSummaryOfEncounterId?` | polymorphic attachment via nullable FKs plus a check constraint allowing at most one clinical parent (encounter may co-exist) |
| `status` (V1 `DocumentStatus`) | |
| `classification` (`DocumentClassification`) + `classificationConfidence Decimal?` + `classifiedBy` (`user`, `model`) | Phase 3 classifier output; user choice always wins |
| `sourceChannel` `DocumentSourceChannel` (`camera`, `gallery`, `file`, `share_target`, `provider_import`, `abdm`) | |
| `pageCount int` | |
| provenance block, `deletedAt` | |

### 7.3 `DocumentPage` (new)
`documentId`, `pageNumber`, `storedObjectId → StoredObject`, `thumbnailObjectId?`, `ocrTextObjectId?` (raw text is stored as an object, not a column), `width?`, `height?`, `rotation?`. Unique `(documentId, pageNumber)`. V1's one-object-per-document rows backfill as page 1. The already-shipped "multi-page documents" feature (commit `c1f0492`) is remapped onto this table.

### 7.4 `DocumentExtraction` (replaces `PrescriptionExtraction`)
`documentId`, `engine`, `engineVersion`, `modelProvider?`, `modelName?`, `modelVersion?`, `promptVersion?`, `status`, `startedAt`, `finishedAt`, `costMicros?`, `rawTextObjectId?`. Every field the roadmap §12 requires for AI traceability.

### 7.5 `ExtractionCandidate` (extend)
`ExtractionField` grows from 3 values to a structured target: `targetEntity` (`medication`, `prescription`, `diagnostic_result`, `diagnostic_report`, `practitioner`, `organization`, `encounter`, `condition`, `allergy`, `immunization`), `targetField` text (schema-validated per entity by `packages/validation`), `pageNumber?`, `boundingBox Json?` (source location), `detectedText`, `proposedValue Json`, `confidence`, `status` (`proposed`, `confirmed`, `corrected`, `rejected`), `confirmedByUserId?`, `correctedValue Json?`, `resultingEntityType?/Id?` (what row was created on confirm). Extraction never writes clinical tables directly; only the confirm endpoint does, stamping `source = ocr_extracted`, `verification = patient_confirmed`, `sourceExtractionId`.

---

## 8. ABDM / ABHA / FHIR persistence (new; Phase 8)

Kept in their own tables so the consumer PHR schema stays clean and HIP/HIU work is separable (roadmap §4 Roles A–D).

| Table | Purpose |
|---|---|
| `AbhaLink` | `patientProfileId` (unique active), `abhaNumberCiphertext`, `abhaNumberDigest` (unique), `abhaAddress`, `linkedAt`, `status` (`active`, `unlinked`, `suspended`), `profileSnapshotJson` (name/gender/yob from ABHA), `lastVerifiedAt` |
| `AbdmCareContext` | discovered/linked care contexts: `abhaLinkId`, `hipId`, `hipName`, `patientReferenceNumber`, `careContextReference`, `display`, `linkedAt`, `status` |
| `AbdmConsentArtefact` | `abhaLinkId`, `consentRequestId`, `artefactId`, `purposeCode`, `hiTypes[]`, `dateRangeFrom/To`, `dataEraseAt`, `frequency`, `hiuId`, `status` (`requested`, `granted`, `denied`, `revoked`, `expired`), `artefactJson`, timestamps. **Separate from `Consent`** by design |
| `AbdmTransaction` | every gateway call: `kind` (`discover`, `link_init`, `link_confirm`, `consent_request`, `consent_notify`, `health_information_request`, `data_push`, …), `requestId`, `transactionId`, `correlationId`, `direction`, `status`, `requestDigest`, `responseDigest`, `errorCode?`, `errorText?`, `startedAt`, `completedAt`, `abdmGatewayEnv` (`sandbox`, `production`) |
| `AbdmDataBundle` | received FHIR bundles: `transactionId`, `consentArtefactId`, `hiType`, `encryptedPayloadObjectId` (R2), `decryptedAt?`, `fhirVersion`, `igVersion`, `entryCount`, `importStatus` (`received`, `validated`, `candidates_created`, `rejected`) |
| `FhirValidationFailure` | `bundleId?`, `direction` (`inbound`, `outbound`), `igVersion`, `profileUrl`, `resourceType`, `path`, `severity`, `message`, `createdAt` — feeds the admin "FHIR validation failures" page |
| `ExternalIdentifier` | generic `(entityType, entityId, system, value, assignerOrganizationId?)` for lab accession numbers, HIP patient references, prescription numbers |

Imported ABDM data (`AbdmDataBundle`) goes through **the same candidate → confirm pipeline** as OCR (§7.5), arriving as `ExtractionCandidate` rows with `source = abdm_imported`, `verification = source_authenticated` on confirm. Import never bypasses confirmation (V1 docs/17 import policy, kept).

---

## 9. Timeline (new)

### 9.1 `HealthEvent`
A denormalized, append-only projection table. Written in the same transaction as the source row via `packages/domain/src/health-events.ts` (mirrors how `packages/audit` is called).

| Field | Notes |
|---|---|
| `patientProfileId`, `occurredAt` timestamptz, `occurredAtLocal` text, `kind` `HealthEventKind` | `prescription`, `medicine_started`, `medicine_changed`, `medicine_stopped`, `medicine_paused`, `medicine_resumed`, `dose_taken`, `dose_missed`, `test_result`, `imaging_report`, `measurement`, `doctor_visit`, `hospital_admission`, `discharge`, `document`, `clinical_note`, `allergy_recorded`, `condition_recorded`, `immunization`, `procedure`, `dispense`, `reconciliation`, `abdm_record_linked`, `share_created`, `caregiver_action` |
| `entityType`, `entityId` | source row |
| `summaryJson` | locale-neutral structured summary for rendering (never free text copied from PHI-bearing fields beyond what the source row already exposes to the same reader) |
| `encounterId?`, `actorUserId?`, `actorType` (`patient`, `caregiver`, `provider`, `system`) | |
| `source`, `verification` | copied from the source row so the timeline can badge trust |
| `supersededAt?` | when the source row was corrected/deleted |

Indexes: `(patientProfileId, occurredAt desc)`, `(patientProfileId, kind, occurredAt desc)`. `dose_taken`/`dose_missed` are **not** projected by default (volume); the timeline reads `DoseEvent` directly for the day view and projects only weekly adherence summaries as `system_derived` events.

### 9.2 Backfill
One-off job walks `MedicationChange`, `Prescription`, `MedicalReport`, the three readings tables, `CheckupRecord`, `PatientDocument`, `PatientAllergy`, `PatientCondition`, `SharePackage`, and writes events. Idempotent by `(entityType, entityId, kind)` unique index.

---

## 10. Conditions, allergies, immunizations, procedures

- **`PatientCondition`**: add `clinicalStatus` (`active`, `remission`, `resolved`, `inactive`, `unknown`), `onsetDate?`, `abatementDate?`, `codeSystem?`/`code?` (SNOMED CT / ICD-10 via terminology layer), `severity?`, `notes?`, `diagnosedByPractitionerId?`, `encounterId?`, provenance block. `label` stays as the immutable entered text.
- **`PatientAllergy`**: add `category` (`medication`, `food`, `environment`, `biologic`, `other`), `reactionText?`, `onsetDate?`, `criticality` (`low`, `high`, `unable_to_assess`) alongside V1 `AllergySeverity`, `verification`, `codeSystem?`/`code?`. Medication allergies keep the `MedicationIngredient` link.
- **`Immunization`** (new): `vaccineText`, `vaccineCode?`, `doseNumber?`, `administeredOn`, `organizationId?`, `lotNumber?`, `documentId?`, provenance.
- **`Procedure`** (new): `procedureText`, `code?`, `performedOn`, `organizationId?`, `practitionerId?`, `encounterId?`, `notes?`, provenance.
- **`FamilyHistory`** (new): `relationship`, `conditionText`, `code?`, `notes?`, provenance.
- **`PatientProfile`** additions: `bloodGroup` `BloodGroup?`, `heightCm?` (last known, derived from `Observation`), `emergencyContacts Json` (already `emergencyCard`; normalize to `EmergencyContact` rows: name, relationship, phoneCiphertext, priority).

---

## 11. Sharing (extend)

`SharePackage`/`ShareLink`/`ShareAccessEvent` stay. Add:
- `SharePackage.sections` gains keys `measurements`, `documents`, `conditions`, `encounters`, `full_passport`; existing frozen-snapshot rule keeps old links from widening.
- `ShareLink.audience` (`doctor`, `clinic`, `caregiver`, `pharmacy`, `unspecified`) and `ShareLink.recipientOrganizationId?` for the clinic product.
- `ShareLink.expiresAt` presets 15 min / 1 h / 24 h / 7 d / custom ≤ 30 d (cap unchanged).
- `ShareLink.tokenHash` moves to a **peppered** hash (V1 uses bare sha256; sessions are peppered). Migration rehashes nothing — new links use the pepper, old links keep working until expiry (≤30 days), then the unpeppered path is removed.
- `DoctorSnapshot` is a **view** (materialized per request), not a table.

---

## 12. Notifications, adherence, caregiver alerts

V1 tables stay (`NotificationChannel`, `Notification`, `NotificationAttempt`, `NotificationPreference`). Add `NotificationKind` values: `measurement_reminder`, `test_due`, `follow_up`, `unusual_measurement` (caregiver, clinically-validated rule only), `new_prescription`, `new_test_result`, `refill_low`. Add `NotificationPreference.channelFrequencyJson` for per-kind channel/frequency controls (roadmap §26 "avoid notification overload").

`TestDueSchedule` (new): `patientProfileId`, `analyteKey`/`diagnosticKind`, `dueOn`, `recurrence?`, `sourcePrescriptionId?`, `status`. Drives "Next test: HbA1c Nov 20".

---

## 13. Administrative and platform tables

- `FeatureFlag` (new): `key`, `description`, `defaultOn`, `rolloutPercent`, `allowProfileIds[]`, `environment`. Replaces the static `GET meta/flags`.
- `AdminDuty` additions: `abdm_operations`, `fhir_view`, `provider_admin`, `support_cases`, `privileged_record_access` (break-glass, always audited with reason).
- `SupportCase` (new): `subject`, `status`, `patientProfileId?` (only with `privileged_record_access` and consent), `notes` append-only.
- `OrganizationMember` (new, V2.6): `organizationId`, `userId`, `role` (`owner`, `doctor`, `staff`, `pharmacist`, `lab_tech`), `status`, `invitedByUserId`. Provider users are ordinary `User` rows with `userKind` (`patient`, `provider`, `both`) added to `User`; authorization for providers is relationship-based via `ShareLink`/`AbdmConsentArtefact`/`ProviderPatientLink` (`organizationId`, `patientProfileId`, `linkedVia` (`qr_onboarding`, `share`, `abdm`), `status`, `expiresAt`) — never by role alone.

---

## 14. Migration plan and sequencing

| # | Migration (name prefix `v2_`) | Phase | Additive? | Backfill job |
|---|---|---|---|---|
| 1 | `v2_provenance_enums` (extend `RecordSource`, add `VerificationState`) | 0 | yes | — |
| 2 | `v2_organizations_practitioners` | 1 | yes | none |
| 3 | `v2_encounters` | 1 | yes | none |
| 4 | `v2_health_events` | 1 | yes | `backfill-health-events` |
| 5 | `v2_provenance_columns` | 1 | yes (nullable) | `backfill-provenance` then `v2_provenance_not_null` |
| 6 | `v2_conditions_allergies_extend` + `v2_immunizations_procedures_family` | 1 | yes | none |
| 7 | `v2_prescription_items_medication_fields` | 2 | yes | `backfill-prescription-items` |
| 8 | `v2_documents_pages_extraction` | 3 | yes | `backfill-document-pages` (V1 `PrescriptionDocument` → `PatientDocument` + page 1) |
| 9 | `v2_diagnostic_reports_results` | 4 | yes | `backfill-diagnostics` (from `MedicalReport`/`ReportValue`) |
| 10 | `v2_observations_devices` | 5 | yes | `backfill-observations` |
| 11 | `v2_caregiver_scopes_consent_notice` | 6 | yes | none |
| 12 | `v2_sharing_extend` | 7 | yes | none |
| 13 | `v2_abdm_tables` | 8 | yes | none |
| 14 | `v2_reconciliation_dispense_refill` | 11/12 | yes | `backfill-refill-plans` |
| 15 | `v2_provider_org_members_flags_support` | 6/11 | yes | none |
| 16 | `v2_sunset_v1_tables` (drop `PrescriptionDocument`, `PrescriptionExtraction`, `MedicalReport`, `ReportValue`, `GlucoseReading`, `BloodPressureReading`, `WeightReading`, `CheckupRecord`; remove old enum values) | after V2.4 | **no** | requires: zero V1 writes for one release, backfill parity report `row_counts_match: true`, restore-test passed on the pre-sunset backup |

Every migration ships with: a Prisma migration, a `prisma migrate diff --exit-code` CI check (already in CI), a backfill script under `packages/database/src/backfills/` that is idempotent and reports counts, an e2e test that runs migrate + backfill against a V1-shaped fixture database (`apps/api/test/migrations/*.e2e-spec.ts`, new), and a rollback note (additive migrations roll back by leaving the columns unused; the sunset migration is preceded by a verified backup and is not reversible).

---

## 15. Row-level scoping and authorization impact

Every new patient table carries `patientProfileId` and is listed in `packages/authorization`'s entity → scope map. The map is exhaustive-checked by a unit test that enumerates Prisma models with a `patientProfileId` column (via the DMMF) and fails if any model lacks a scope entry. Provider access (V2.6+) is evaluated through `ProviderPatientLink` + section grants, never by organization membership alone.

---

## 16. What this model deliberately does not do

- No FHIR resource tables, no JSONB FHIR blobs as the source of truth (ADR-V2-001).
- No free-form "notes" table that could become an EMR; clinical notes are documents or encounter fields.
- No insurance/claims, no pharmacy inventory, no telemedicine sessions (roadmap §41).
- No interpretation/flags computed on the client; all `interpretation` values originate from labs, providers, or clinically approved rules (roadmap §29).
