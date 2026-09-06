# 07 — Workstreams

The roadmap §7 defines eighteen parallel workstreams. This maps each onto repository areas, the phases it drives, its standing gates, and the artefacts it owns. A person can hold more than one workstream; a workstream never has zero owners.

| ID | Workstream | Repo areas | Drives | Owns |
|---|---|---|---|---|
| WS01 | Product strategy & program management | `docs_v2/` | all | roadmap, [20 status board](20-status-board.md), dependency register [16](16-dependencies-and-risks.md), Product Council agenda |
| WS02 | UX, accessibility & localization | `apps/patient-web`, `apps/provider-web`, `packages/ui-web`, `design-tokens`, `localization`, guidance audio | P1–P7, P11, P16 | screen specs (extends `docs/07`), axe/reflow gates, Gate 4 comprehension, locale publishing |
| WS03 | Patient health record | `packages/database` (profile/encounter/health-event tables), `apps/api/modules/{profiles,encounters,timeline}` | P1, P10 | canonical model §2–3, §9–10 of [04](04-canonical-clinical-model.md) |
| WS04 | Medication & prescription platform | `modules/{medications,prescriptions,scheduling}`, `packages/medication-terminology`, `packages/clinical-rules` | P2, P9, P12, P14 | medication model, reconciliation, refill, catalog adapter |
| WS05 | Tests & diagnostics | `modules/diagnostics`, `packages/terminology` (analytes) | P4, P13 | `DiagnosticReport/Result`, trends, lab adapters, Gate 1b |
| WS06 | Home measurements | `modules/observations`, `MeasurementDevice`, device connectors | P5 | `Observation`, trend analytics, device provenance |
| WS07 | Document intelligence & AI | `apps/worker`, `packages/document-intelligence`, `packages/object-storage` | P3, P4 (lab extraction), P13 | pipeline, provider adapters, Gates 5–6, AI traceability |
| WS08 | Caregiver & sharing | `modules/{care-relationships,sharing}`, `packages/authorization`, `consent` | P6, P7 | scopes, family dashboard, Doctor Snapshot, share presets |
| WS09 | ABDM & interoperability | `packages/fhir`, `packages/terminology`, `apps/abdm-gateway`, `modules/abdm` | P8, P15 | IG version pins, artifact mapping, conformance suite, sandbox exit pack |
| WS10 | Provider products | `apps/provider-web`, `modules/providers` | P11–P14 | clinic/pharmacy/lab/hospital workflows, `ProviderPatientLink` |
| WS11 | Clinical intelligence & safety | `packages/clinical-rules`, hazard log, Safety Board | P2, P9, P10 | rule versions, explanations, Gates 1–3, [10](10-clinical-safety-and-ai-governance.md) |
| WS12 | Platform & data engineering | `packages/database`, `health-events`, `provenance`, queue, migrations/backfills | P0–P5 | migration plan §14 of [04](04-canonical-clinical-model.md), ADR-V2-006/007/008 |
| WS13 | Security, privacy & compliance | `apps/api` auth/crypto, `packages/audit`, DPIA, DPDP | P0, P6, P8, P11 | [11](11-security-privacy-compliance.md), step-up, keyring, break-glass, vendor DPAs |
| WS14 | DevSecOps & reliability | `.railway/`, `infra/`, `ci.yml`, `packages/observability`, backups | P0, all | [12](12-deployment-and-environments.md), [14](14-observability-and-operations.md), DR drills |
| WS15 | QA & clinical validation | `apps/*/test`, `e2e/`, corpora, conformance harness | all | [13](13-verification-and-quality.md), Gate evidence under `docs_v2/validation/` |
| WS16 | Analytics & administration | `apps/admin-web`, `modules/admin`, product metrics | P1, P8, P11 | admin platform pages, PHI-free metrics pipeline |
| WS17 | Adoption & partnerships | outside the repo; pilot config | P11–P14, pilot | [17](17-pilot-plan.md) partner list, onboarding kits |
| WS18 | Support & operations | runbooks, `SupportCase`, on-call | all | incident process, patient/provider support (resolves OD-17), knowledge base |

## Cadence

- **Weekly:** each workstream updates its rows in [20](20-status-board.md) (status vocabulary from the README).
- **Fortnightly:** Architecture Board (ADRs, migrations), Clinical Safety Board (rules, copy, hazards), Privacy & Security Board (DPIA deltas, access reviews).
- **Monthly:** Product Council (scope, phase gates), dependency review ([16](16-dependencies-and-risks.md)).
- **Per phase:** exit-gate review with the evidence listed in [06](06-phase-plan.md) attached.

## Interfaces between workstreams (the ones that bite)

| Producer → Consumer | Contract | Where enforced |
|---|---|---|
| WS12 provenance → everyone | provenance block shape and state machine | `packages/provenance` types + CI provenance-column check |
| WS03 health events → WS02 timeline | `HealthEvent` DTO | OpenAPI pin |
| WS05/WS06 terminology → WS09 FHIR | analyte/concept → LOINC/UCUM tables, versioned | `packages/terminology` snapshot tests |
| WS07 extraction → WS03/04/05 | `ExtractionCandidate.targetEntity/targetField` schemas | `packages/validation` per-entity schemas |
| WS10 proposals → WS04/05 | proposal objects; patients accept | ADR-V2-009 + accept endpoints |
| WS09 gateway → WS12 queue | `AbdmTransaction` + job payloads | queue job schemas |
| WS11 rules → WS02 copy | finding explanation keys + four statements | copy lint + Gate 2 |
| WS13 → all | step-up list, audit action taxonomy | `packages/domain/src/audit-actions.ts`, guard decorator |
