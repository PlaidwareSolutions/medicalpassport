# ABDM FHIR Implementation Guide pins

`@medpass/fhir` builds one folder per IG version under `src/ig/` (ADR-V2-003).
Changing a pin below is a reviewed PR: this file, the folder, and its conformance fixtures move together.

FHIR base version for every folder: **R4 (4.0.1)**. If NRCeS moves to R4B/R5 that becomes a new folder, not an edit here.

| IG version | Folder | Status | Published by | URL | Notes |
|---|---|---|---|---|---|
| NRCeS ABDM FHIR IG **v6.5.0** | `src/ig/v6_5/` | current published version | NRCeS | https://nrces.in/ndhm/fhir/r4/ | Certification target until sandbox/production requires otherwise |
| NRCeS ABDM FHIR IG **v7.0.0** | `src/ig/v7_0/` | active preview (July 2026) | NRCeS | https://nrces.in/ndhm/fhir/r4/ | Adds the Indian Patient Summary and additional vital-sign profiles (`ObservationBP`, `ObservationBodyWeight`, `ObservationHeartRate`, `ObservationOxygenSat`) |

Verification: verified 2026-09-06 from the roadmap (docs_v2/08 §2, ADR-V2-003); re-verify against the site before changing the production pin.

## Profiles referenced

| Resource | Profile canonical | v6_5 | v7_0 |
|---|---|---|---|
| `AllergyIntolerance` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance` | yes | yes |
| `Provenance` | `http://hl7.org/fhir/StructureDefinition/Provenance` (base R4; NRCeS defines no Provenance profile) | yes | yes |
| `Patient` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient` | yes | yes |
| `Practitioner` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner` | yes | yes |
| `Organization` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization` | yes | yes |
| `Medication` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/Medication` | yes | yes |
| `MedicationRequest` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest` | yes | yes |
| `MedicationStatement` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationStatement` | yes | yes |
| `DiagnosticReport` (lab) | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab` | yes | yes |
| `DiagnosticReport` (imaging) | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportImaging` | yes | yes |
| `Observation` (lab result, wellness) | `http://hl7.org/fhir/StructureDefinition/Observation` (base R4; NRCeS defines no lab-result Observation profile) | yes | yes |
| `Observation` (vital sign, generic) | `http://hl7.org/fhir/StructureDefinition/vitalsigns` (base R4 vital-signs) | yes | yes (fallback for concepts without a v7 profile) |
| `Observation` blood pressure | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationBP` | — | yes |
| `Observation` body weight | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationBodyWeight` | — | yes |
| `Observation` heart rate | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationHeartRate` | — | yes |
| `Observation` SpO2 | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationOxygenSat` | — | yes |
| `Condition` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition` | yes | yes |
| `DocumentReference` | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentReference` | yes | yes |
| `Composition` PrescriptionRecord | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord` | yes | yes |
| `Composition` DiagnosticReportRecord | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord` | yes | yes |
| `Composition` Indian Patient Summary | `https://nrces.in/ndhm/fhir/r4/StructureDefinition/IndianPatientSummary` — **provisional**: the v7.0 preview canonical must be confirmed against the published preview before certification | — | yes (`ig/v7_0/ips.ts`) |

Local code systems (used only when no national/international code is mapped; every use is reported as a `FhirValidationFailure`-shaped warning):
`https://medicinepassport.app/CodeSystem/{medication,analyte,observation-concept,document-kind,condition,diagnostic-report-kind,frequency-code}`.

## Artifact coverage (docs_v2/08 §6)

| # | Artifact | Canonical DTO | Serializer | Conformance fixtures |
|---|---|---|---|---|
| 1 | PrescriptionRecord | `CanonicalPrescriptionRecord` | `serializePrescriptionRecord` | `prescription-record.json` per folder |
| 2 | Medication | `CanonicalMedication` | `serialize({kind:"Medication"})` | `medication.*.json` |
| 3 | MedicationRequest | `CanonicalMedicationRequest` | `serialize({kind:"MedicationRequest"})` | `medication-request.*.json` |
| 4 | MedicationStatement | `CanonicalMedicationStatement` | `serialize({kind:"MedicationStatement"})` | `medication-statement.*.json` |
| 5/7 | DiagnosticReport lab / imaging + DiagnosticReportRecord | `CanonicalDiagnosticReport`, `CanonicalDiagnosticReportRecord` | `serialize({kind:"DiagnosticReport"})`, `serializeDiagnosticReportRecord` | `diagnostic-report.*.json`, `diagnostic-report-record.json` |
| 6 | Observation (lab) | `CanonicalLabObservation` | `serialize({kind:"ObservationLab"})` | `observation-lab.*.json` |
| 8–12 | Observation (wellness / BP / weight / heart rate / SpO2) | `CanonicalVitalObservation` | `serialize({kind:"ObservationVital"})` | `observation-vital.*.json`, `observation-wellness.*.json` |
| 13 | Condition | `CanonicalCondition` | `serialize({kind:"Condition"})` | `condition.*.json` |
| 14 | AllergyIntolerance | `CanonicalAllergy` | `serialize({kind:"AllergyIntolerance"})` | `allergy-intolerance.*.json` |
| 15 | DocumentReference | `CanonicalDocumentReference` | `serialize({kind:"DocumentReference"})` | `document-reference.*.json` |
| 16 | Provenance | `CanonicalProvenance` | emitted with every resource | covered by every golden |
| §8 | Indian Patient Summary | `CanonicalPatientSummary` | `serializePatientSummary` (v7.0 only) | `v7_0/patient-summary.json` |
| — | Patient / Practitioner / Organization | `CanonicalPatient` / `CanonicalPractitioner` / `CanonicalOrganization` | `serialize({kind:…})` | `patient.*.json`, `practitioner.*.json`, `organization.*.json` |

Golden fixtures are regenerated from the canonical fixtures by running the serializers; a golden that changes is a reviewed diff.

## Rules

- The API never imports `src/ig/*` directly; it goes through `getIg(version)` / `serialize(entity, { ig })` / `validateResource(resource, { ig })` / `serialize*Record` / `serializePatientSummary`.
- Version folders may share code through `src/common/` but never import each other.
- Every serializer refuses a row without a provenance block (`ProvenanceMissingError`, ADR-V2-002).
- Attachments are exported by opaque reference (`urn:medicinepassport:stored-object:<id>`); the validator rejects an http(s) `Attachment.url`.
- This package is pure: no `@medpass/database`, no Prisma, no network (guarded by `test/purity.test.ts`). Its only runtime dependencies are `zod` and `@medpass/terminology` (versioned tables + pure functions).
