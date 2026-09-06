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

## Rules

- The API never imports `src/ig/*` directly; it goes through `getIg(version)` / `serialize(entity, { ig })` / `validateResource(resource, { ig })`.
- Version folders may share code through `src/common/` but never import each other.
- This package is pure: no `@medpass/database`, no Prisma, no network (guarded by `test/purity.test.ts`).
