# 03 — Target Architecture (V2)

Extends `docs/12-system-architecture.md`. What does not change: Next.js PWA + NestJS API + Postgres on Railway, Cloudflare edge + private R2, clinical rules server-side only, Postgres-backed job queue (the "BullMQ" name in ADR-3 was never implemented; ADR-V2-006 records the Postgres queue as the decision).

## 1. Runtime topology

```
                     Cloudflare (edge, WAF, R2)
                                │
   ┌────────────┬───────────────┼────────────────┬──────────────┐
patient-web  provider-web   admin-web         api            abdm-gateway
 (PWA)        (new, V2.6)    (ops)         (NestJS)          (new, V2.4)
                                                │                 │
                                     ┌──────────┴──────────┐      │
                                   worker                 cron    │
                              (OCR/AI/PDF/FHIR)      (16 one-shots)│
                                                │                 │
                                            PostgreSQL ◄──────────┘
                                                │
                                              R2 (docs, derived, backups, abdm-inbox)
```

New services:

- **`apps/abdm-gateway`** — the only process holding ABDM gateway credentials and the HIU/HIP private keys. Receives gateway callbacks on its own hostname, verifies them, and writes `AbdmTransaction` rows plus queue jobs. The API never talks to the ABDM gateway directly. This isolates certification scope and keeps the consumer PHR deployable without ABDM (roadmap §4 "HIP/HIU capability separated from the consumer PHR").
- **`apps/provider-web`** — clinic/pharmacy/lab portal. Separate Next.js app so its bundle, auth and CSP are independent from the patient PWA. Shares `packages/ui-web`, `api-client`, `localization`, `design-tokens`.

New packages:

| Package | Responsibility |
|---|---|
| `packages/terminology` | Versioned code systems and mappings: analyte keys → LOINC, observation concepts → LOINC, conditions → SNOMED CT/ICD-10, catalog ingredients → RxNorm/local CodeSystem, UCUM units, unit conversion. Pure functions + versioned JSON tables. Never calls the network at runtime |
| `packages/fhir` | Canonical model ↔ FHIR R4 serializer/parser, profile validator (ABDM IG v6.5 and v7.x), version mapper, conformance test harness. Pure; no DB access |
| `packages/document-intelligence` | Classification, extraction target schemas, confidence policy, provider adapters (OCR, AI) behind interfaces; used by the worker only |
| `packages/health-events` | `emitHealthEvent(tx, …)` helper and the projection rules per entity; used by API services in the same transaction as the source write |
| `packages/provenance` | Types, state machine and validators for the provenance block; used by validation, API, worker |

`packages/clinical-rules` (currently an inert scaffold) becomes the real home of the safety engine, moved out of `apps/api/src/modules/safety/safety-rules.ts` so the worker and provider flows can evaluate through the same code. Rules still only execute on Railway.

## 2. Service boundaries inside the API

The API stays a single NestJS deployable (V1 is a flat `AppModule`). V2 introduces feature modules so ownership and tests are clear, without splitting deployments:

`identity` · `profiles` · `care-relationships` (caregivers, claims, consent) · `medications` · `prescriptions` · `diagnostics` · `observations` · `documents` · `extraction` · `encounters` · `timeline` · `safety` · `sharing` · `notifications` · `abdm` (client-side of the gateway) · `providers` (organizations, links, reconciliation) · `admin` · `platform` (health, meta, flags, sync).

Rules per module: one controller per resource, DTOs from `packages/validation`, authorization via `ProfileAccessService.require` (kept) with the entity → scope map extended, audit via `packages/audit` in the same transaction, `HealthEvent` emitted in the same transaction, provenance stamped by the service (never trusted from the client).

## 3. Event model

Two kinds of events, deliberately different:

1. **`HealthEvent`** — patient-facing projection (timeline). Written synchronously in the source transaction. Never consumed by other services; it is a read model.
2. **Domain jobs** — `BackgroundJob` queue (existing) gains queues: `document_classify`, `document_extract`, `fhir_validate`, `abdm_outbound`, `abdm_inbound_import`, `trend_recompute`, `health_event_backfill`, `notification_dispatch` (moving from cron polling to queue where latency matters). Idempotent by `jobKey`; DLQ + admin replay already exist.

There is no message broker. The Postgres queue is adequate for the volumes in `docs/31` (tens of thousands of jobs/day); ADR-V2-006 lists the trigger for revisiting (sustained queue lag > 60 s at p95 or > 1M jobs/day).

## 4. Provenance and verification

Defined in [04](04-canonical-clinical-model.md) §1. Architectural consequences:

- `packages/validation` DTOs never accept `source`/`verification` from clients; services set them from the authenticated actor and channel (`recordedVia` from the `x-client` header validated against an allowlist).
- The FHIR serializer emits a `Provenance` resource per exported resource and refuses to export a row without provenance (fails closed).
- The UI badges trust in three tiers: "you added this", "from a document you scanned (confirmed by you)", "from `<lab/clinic>` (verified)". Copy in `packages/localization`, reviewed at Gate 4.

## 5. Identity model

| Identity | Today | V2 |
|---|---|---|
| Patient | phone-OTP `User` + `PatientProfile` | unchanged; optional `AbhaLink` per profile |
| Dependant | profile owned by guardian, claimable | unchanged |
| Caregiver | own `User`, relationship + scopes | more scopes; step-up for scope changes |
| Provider user | — | `User.userKind = provider|both`, `OrganizationMember`; login via phone-OTP or email+TOTP (reusing admin auth primitives); relationship-based patient access only |
| Admin | email + mandatory TOTP | unchanged; new duties; break-glass duty with reason |
| ABHA | — | held by `abdm-gateway`; API sees only `AbhaLink` |

Sessions stay opaque server-side tokens (ADR-5). Step-up: `POST /v1/auth/step-up` re-runs OTP (or TOTP for admins/providers) and stamps `Session.stepUpVerifiedAt`; guarded endpoints check freshness ≤ 10 min.

## 6. Caregiver authorization

`packages/authorization` keeps the matrix approach. V2 makes it **generated and exhaustive**: the scope enum and the entity map produce the matrix; a unit test enumerates every Prisma model with `patientProfileId` and every `CaregiverScope` and asserts a defined decision. Provider access reuses the same evaluator with `ProviderPatientLink` grants as the "relationship".

## 7. Consent architecture

Three separate objects, never merged:

| Object | Purpose | Store |
|---|---|---|
| `Consent` (+ `ConsentNotice`) | DPDP purpose-bound processing consent between patient and MedicinePassport | app DB |
| `ShareLink` | patient → recipient disclosure inside MedicinePassport | app DB |
| `AbdmConsentArtefact` | HIE-CM consent between patient and HIU via ABDM | app DB, written only by `abdm-gateway` |

Revocation of any one never implies revocation of another; the UI shows all three on one "Sharing & consent" screen with distinct labels.

## 8. FHIR and ABDM layers

```
Canonical model (Prisma rows)
        │  packages/fhir/serializer (per IG version)
        ▼
FHIR R4 Bundle  ──► packages/fhir/validator (profile + terminology) ──► FhirValidationFailure rows on error
        │
        ▼
abdm-gateway (transport adapter, encryption, callbacks)  ◄──►  ABDM Gateway / HIE-CM
        ▲
        │  inbound bundles → parser → ExtractionCandidate rows (never direct writes)
```

Details, versions and the artifact table in [08](08-abdm-fhir-integration.md). The API depends on `packages/fhir` only for export/import; the DB never stores FHIR as the source of truth (ADR-V2-001).

## 9. Document processing pipeline

```
UPLOAD → validate (magic bytes, sha256, size, AV scan) → PatientDocument + DocumentPage rows
      → job document_classify → classification + confidence
      → job document_extract (OCR provider → text objects; AI extraction → candidates with page/bbox/confidence)
      → patient/provider confirmation → structured rows with provenance → HealthEvent
      → original object preserved forever (subject to retention policy)
```
Owner: `apps/worker` + `packages/document-intelligence`. Details in [09](09-document-intelligence.md).

## 10. Offline and sync

`POST /v1/sync` and the `OfflineMutation` idempotency stay. V2 registers three more sync entities: `observation` (create), `dose_event` (already), `patient_medication` (already), `document_upload_intent` (create; the bytes upload when online). The contract's declared-but-undispatched entities are either implemented or removed from the contract in Phase 0 (test asserts contract == dispatcher).

## 11. Multi-tenancy for providers

Organizations are tenants for the provider portal only. Patient data is never partitioned by organization; a provider reads patient data only through a `ProviderPatientLink` (QR onboarding, share, or ABDM consent) with an expiry, and every read is audited with the organization id. Row-level scoping remains `patientProfileId`.

## 12. Localization and voice

`packages/localization` grows from 4 to 10 locales behind a `PUBLISHED_LOCALES` gate (already the pattern in marketing). Voice entry is a client capability (Web Speech API, later native STT) that produces a **proposal** rendered through the same confirmation UI as OCR candidates; no clinical row is written from speech without confirmation (roadmap §25).

## 13. Cross-cutting decisions recorded as ADRs

| ADR | Decision |
|---|---|
| ADR-V2-001 | Product-shaped canonical model; FHIR at the boundary only |
| ADR-V2-002 | Mandatory provenance block with monotonic verification state |
| ADR-V2-003 | Versioned FHIR compatibility layer (IG v6.5 and v7.x side by side) |
| ADR-V2-004 | Three separate consent objects |
| ADR-V2-005 | `abdm-gateway` as an isolated service |
| ADR-V2-006 | Postgres job queue retained; revisit triggers |
| ADR-V2-007 | Additive-only migrations until V2.4; single sunset migration after parity proof |
| ADR-V2-008 | `HealthEvent` synchronous projection table |
| ADR-V2-009 | Providers propose, patients accept |
| ADR-V2-010 | Hosting validated against ABDM certification before production ABDM; region change allowed |
| ADR-V2-011 | Generic `Observation` table replaces per-vital tables |
| ADR-V2-012 | Step-up authentication for sensitive operations |
| ADR-V2-013 | OpenAPI as the API contract source of truth, generated from Nest decorators + Zod |
| ADR-V2-014 | ESLint (typescript-eslint + jsx-a11y) gate in CI |

Full text in [adr/](adr/README.md).
