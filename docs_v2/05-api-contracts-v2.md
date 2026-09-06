# 05 — API Contracts V2

Extends `docs/14-api-contracts.md`. Conventions unchanged: `/v1` prefix, RFC 7807 errors with `code` + `correlationId`, opaque session cookie or bearer, `x-requested-with: medpass`, `x-profile-id` for the active profile, `idempotency-key` on writes that may be retried, cursor pagination (`?cursor=&limit=`), `rowVersion` on updatable resources. Every list endpoint filters `deletedAt IS NULL` unless `?includeDeleted=true` with an admin duty.

New global rules:

- **`x-client`** header (`pwa`, `native_android`, `native_ios`, `provider_web`) validated against an allowlist and stored as `recordedVia`. Missing → `pwa`.
- Every clinical DTO returned includes a `provenance` object `{source, verification, recordedVia, recordedAt, recordedBy: {kind, displayLabel}, sourceDocumentId?, sourceOrganizationId?}`.
- Clients can never send `provenance`; it is stripped by validation (400 `provenance_not_client_settable` if present).
- **Step-up** endpoints respond `403 step_up_required` when `Session.stepUpVerifiedAt` is older than 10 minutes.
- Versioning: additive changes only within `/v1`. Breaking changes ship under `/v2` routes side by side; `/v1` routes are removed one release after the last client version that calls them (contract test enforces).
- OpenAPI 3.1 document generated at build (`apps/api/openapi.json`), pinned in the repo, diffed in CI (ADR-V2-013).

> **Drift check (2026-09-06).** Where a row below was renamed on the way into code, the row shows the path that ships today (verified against `apps/api/openapi.json`, 306 operations) with a *Renamed:* note carrying the name this document first proposed. The pinned document is the contract of record; this file explains the shape and the intent.

## 1. Identity and sessions

| Method | Path | Notes |
|---|---|---|
| POST | `auth/step-up` | body `{method: "otp"}` → sends OTP; `auth/step-up/verify {code}` stamps `stepUpVerifiedAt`. Providers/admins use TOTP |
| GET | `auth/session` | current session incl. `stepUpFresh: boolean` |

## 2. Profiles and clinical profile (Phase 1)

| Method | Path | Scope | Notes |
|---|---|---|---|
| PATCH | `profiles/current` | manage_profile | adds `bloodGroup`, `heightCm` |
| GET/POST/PATCH/DELETE | `profiles/current/emergency-contacts[/:id]` | manage_profile | |
| GET/POST/PATCH/DELETE | `profiles/current/conditions[/:id]` | view/manage_profile | new fields: `clinicalStatus`, `onsetDate`, `abatementDate`, `code` |
| GET/POST/PATCH/DELETE | `profiles/current/allergies[/:id]` | | new: `category`, `reactionText`, `criticality` |
| GET/POST/PATCH/DELETE | `profiles/current/immunizations[/:id]` | | |
| GET/POST/PATCH/DELETE | `profiles/current/procedures[/:id]` | | |
| GET/POST/PATCH/DELETE | `profiles/current/family-history[/:id]` | | |
| GET/POST/PATCH/DELETE | `profiles/current/organizations[/:id]` | manage_profile | patient-scoped facilities; `POST organizations/:id/merge` |
| PATCH | `practitioners/:id` | | adds `registrationNumber`, `registrationCouncil`, `organizationId` |
| GET/POST/PATCH/DELETE | `profiles/current/encounters[/:id]` | | `GET encounters/:id` includes linked prescriptions, reports, documents, observations |

## 3. Timeline (Phase 1)

| Method | Path | Notes |
|---|---|---|
| GET | `profiles/current/health-timeline` | `?from&to&kinds[]&cursor&limit`; returns `HealthEvent` DTOs newest first, with `verification` badge data; excludes `dose_*` unless `?includeDoses=true` |
| GET | `profiles/current/health-timeline/summary` | counts per kind for the home card ("Medicines 8 active, Tests 38, …") |
| GET | `profiles/current/timeline` | **unchanged** (today's doses); documented as "dose timeline" to avoid confusion |

## 4. Medications and prescriptions (Phase 2)

| Method | Path | Notes |
|---|---|---|
| PATCH | `medications/:id` | new instruction fields `route`, `strengthLabel`, `durationDays`, `stopPlannedAt`; `reasonConditionId`; `prescribingPractitionerId` |
| GET | `medications/:id/history` | unchanged shape plus `changeKind` values for reconciliation |
| GET/PUT | `medications/:id/refill-plan` | `packSize`, `quantityOnHand`, computed `projectedRunOutOn` |
| POST | `prescriptions` | now accepts `items[]` (line items), `diagnosisText`, `validUntil`, `followUpOn`, `encounterId` |
| GET/POST/PATCH/DELETE | `prescriptions/:id/items[/:itemId]` | |
| POST | `prescriptions/:id/items/:itemId/start-medication` | creates a `PatientMedication` from a line item (provenance `source` copied from the prescription) |
| GET | `profiles/current/proposals` | the patient's inbox of everything awaiting acceptance — reconciliations, prescriptions, encounters, dispenses, diagnostic reports, discharge transitions — cursor-paged, `?status=`; `GET proposals/:id` for one. *Renamed:* proposed as `profiles/current/medication-reconciliations`; built as one proposals inbox across every kind (ADR-V2-009) rather than a medication-only list |
| POST | `proposals/:id/accept` / `reject` | accept is step-up and is the only path that writes clinical tables — a reconciliation writes `MedicationChange` rows; individual lines can be declined. *Renamed:* proposed as `medication-reconciliations/:id/accept\|reject` |

## 5. Documents and extraction (Phase 3)

Multi-page documents ship under `patient-documents/*`, candidates under `document-candidates/*` and batch materialization under `document-extractions/*`. *Renamed:* this document first proposed `documents/*`, `extraction-candidates/*` and `extractions/*`; V1's single-object routes already owned those names (`POST profiles/current/documents/authorize-upload`, `documents/:id/{complete,download-url,process,extraction}`, `extraction-candidates/:id/{confirm,reject}`, `extractions/:id/create-medication`) and stay in place, read-mostly, until the §15 sunset — so the V2 family took distinct prefixes rather than overloading V1's.

| Method | Path | Notes |
|---|---|---|
| POST | `profiles/current/patient-documents` | creates `PatientDocument` with `kind?`, `title?`, `documentDate?`, `sourceChannel`, links (`prescriptionId?`, `diagnosticReportId?`, `encounterId?`); returns upload authorizations for N pages. *Renamed:* `profiles/current/documents` |
| GET | `profiles/current/patient-documents` | list, cursor-paged. *Renamed:* not in the original table; `GET profiles/current/documents` remains the V1 single-object list |
| POST | `patient-documents/:id/pages/authorize-upload` | add pages later. *Renamed:* `documents/:id/pages/authorize-upload` |
| POST | `patient-documents/:id/pages/:pageNumber/complete` | verify + trigger classify/extract. *Renamed:* `documents/:id/pages/:n/complete` |
| PATCH | `patient-documents/:id` | user override of `kind`, links, title. *Renamed:* `documents/:id` |
| GET | `patient-documents/:id` | pages with thumbnail/download URLs (short-lived), classification, extraction status. *Renamed:* `documents/:id` |
| DELETE | `patient-documents/:id` | soft delete; object retention per policy. *Renamed:* `documents/:id` |
| POST | `patient-documents/:id/process` | re-run extraction (idempotent by content hash + engine version). *Renamed:* `documents/:id/process` |
| GET | `patient-documents/:id/extraction` | candidates grouped by `targetEntity`, with `pageNumber`, `boundingBox`, `confidence`. *Renamed:* `documents/:id/extraction` |
| POST | `document-candidates/:id/confirm` | body may carry `correctedValue`; returns the created/updated clinical row id. *Renamed:* `extraction-candidates/:id/confirm` — that V1 route still exists and confirms a V1 single-object extraction candidate |
| POST | `document-candidates/:id/reject` | *Renamed:* `extraction-candidates/:id/reject` (V1 route still exists) |
| POST | `document-extractions/:id/materialize` | batch-confirm a set of candidates into one prescription/report (transactional). *Renamed:* `extractions/:id/materialize` |
| — | ~~`POST profiles/current/documents/share-target`~~ | **Replaced, not renamed.** There is no server-side share-target sink. The PWA registers a Web Share Target (`/share-target` in `apps/patient-web`) that receives the shared file in the browser, asks which profile it is for first (H-38), and then runs the ordinary `POST profiles/current/patient-documents` → page upload → complete flow above — so a shared file is never accepted for a profile the user did not pick, and the service worker never caches the route. Native share sheets later go the same way |

## 6. Diagnostics (Phase 4)

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `profiles/current/diagnostic-reports[/:id]` | replaces `reports`; V1 `reports` endpoints stay as a read-only façade until sunset |
| GET/POST | `diagnostic-reports/:id/results` | |
| PATCH | `diagnostic-results/:id` | creates a superseding row; original immutable |
| GET | `profiles/current/diagnostic-results` | `?analyteKey&loinc&from&to`; every row returns canonical `unit` and `enteredUnit` |
| GET | `profiles/current/trends/results/:analyteKey` | series with unit, reference range per point, provenance per point; never mixes units |
| GET | `terminology/analytes` | vocabulary with LOINC, canonical unit, allowed entered units |

## 7. Observations (Phase 5)

| Method | Path | Notes |
|---|---|---|
| GET/POST/DELETE | `profiles/current/observations[/:id]` | `?concept&from&to`; POST body `{concept, valueNumeric, valueNumeric2?, unit?, enteredUnit?, context?, bodySite?, measuredAt, notes?, clientMutationId?}` |
| POST | `profiles/current/observations/batch` | device sync; dedupe by `(concept, measuredAt, sourceDeviceId)` |
| GET | `profiles/current/trends/observations/:concept` | `?window=7d|30d|90d&bucket=day|week|month`; returns rolling average, min/max, morning/evening split |
| GET/POST/PATCH/DELETE | `profiles/current/measurement-devices[/:id]` | |
| GET | `profiles/current/{blood-pressure,weight,glucose}-readings` | **kept**, served from `Observation` after backfill; write endpoints return 410 after V2.2 with `Link` to the replacement |

## 8. Caregivers (Phase 6)

| Method | Path | Notes |
|---|---|---|
| PATCH | `caregivers/:id/scopes` | step-up; new scopes accepted |
| GET | `profiles/current/family` | caregiver's dashboard: every profile they can act on with per-profile summary (due doses, alerts, last measurement) |
| GET | `profiles/current/activity` | patient-facing "who changed what": `HealthEvent` + audit rows where `actorType = caregiver` |

## 9. Sharing (Phase 7)

| Method | Path | Notes |
|---|---|---|
| POST | `profiles/current/shares` | step-up; `sections[]` gains `measurements`, `documents`, `conditions`, `encounters`, `full_passport`; `audience`; `expiresIn` preset or `expiresAt` ≤ 30 d |
| GET | `profiles/current/doctor-snapshot` | the concise clinician view (current meds, allergies, conditions, recent changes, important recent tests, 30-day measurements, relevant documents) |
| GET | `public/shares/:token/snapshot` | same shape, public, no-store |
| GET | `public/shares/:token/documents/:documentId/pages/:n` | only when `documents` is a shared section; short-lived signed URL redirect; every access logged |

## 10. ABDM (Phase 8)

Patient-facing (API):

| Method | Path | Notes |
|---|---|---|
| GET | `profiles/current/abha` | link status |
| POST | `profiles/current/abha/link/init` | step-up; body `{method: "abha_number"\|"mobile"\|"aadhaar_otp"}`; returns a `transactionId` |
| POST | `profiles/current/abha/link/verify` | OTP/consent completion |
| DELETE | `profiles/current/abha` | unlink (does not delete imported records; they keep provenance) |
| POST | `profiles/current/abha/discover` | initiates discovery; results via polling `GET …/discover/:txnId` or push |
| POST | `profiles/current/abha/care-contexts/link` | |
| GET | `profiles/current/abdm/consents` | `AbdmConsentArtefact` list (distinct screen from `Consent`) |
| POST | `profiles/current/abdm/consents/:id/revoke` | step-up |
| GET | `profiles/current/abdm/bundles` | received bundles, import status |
| POST | `abdm/bundles/:id/import` | creates candidates (never direct rows) |
| GET | `profiles/current/fhir/export` | `Bundle(collection)` for the patient's own data; `?ig=6.5\|7.0`; step-up; audited |

Gateway (`apps/abdm-gateway`, own hostname, callbacks only): `POST /v0.5/patients/on-find`, `/links/link/on-init`, `/links/link/on-confirm`, `/consents/hiu/notify`, `/health-information/hiu/on-request`, `/health-information/transfer`, plus the versions the sandbox requires at the time. Every callback verifies the gateway JWT, writes `AbdmTransaction`, enqueues, returns 202.

## 11. Providers (Phases 11–14)

Provider session (`provider-web`), authorization via `OrganizationMember` + `ProviderPatientLink`:

| Method | Path | Notes |
|---|---|---|
| POST | `provider/auth/login`, `…/totp`, `…/logout` | |
| GET/POST/PATCH | `provider/organizations/current[/members]` | owner only |
| POST | `provider/patients/onboard` | body `{qrToken}` from the patient's app → `ProviderPatientLink` (expiry, sections) |
| GET | `provider/patients` | linked patients (labels only, no clinical data) |
| GET | `provider/patients/:linkId/snapshot` | doctor snapshot within granted sections; audited with org id |
| POST | `provider/patients/:linkId/reconciliations` | proposal with lines |
| POST | `provider/patients/:linkId/prescriptions` | captured prescription → arrives in the patient's confirmation queue as candidates with `source = clinic_entered` |
| POST | `provider/patients/:linkId/encounters` | encounter proposal |
| POST | `provider/patients/:linkId/dispenses` | pharmacy: dispense record (proposal; patient sees "Apollo Pharmacy recorded a refill") |
| POST | `provider/patients/:linkId/diagnostic-reports` | lab: report + results, lands `source_authenticated` but still queued for the patient to accept into the passport |
| POST | `provider/patients/:linkId/discharge` | hospital transition: START/CONTINUE/CHANGE/STOP lines + documents |
| POST | `provider/abdm/consent-requests` | HIU request (V2.8) |

Patient side: `GET profiles/current/provider-links`, `POST provider-links/:id/revoke` (step-up), `GET profiles/current/proposals` (everything awaiting acceptance: reconciliations, prescriptions, dispenses, reports, encounters), `POST proposals/:id/accept|reject`.

## 12. Notifications (Phase 17)

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `profiles/current/notification-preferences` | per-kind `{channels[], frequency}` |
| GET/POST/PATCH/DELETE | `profiles/current/test-due[/:id]` | drives `test_due` reminders |
| POST | `notification-channels/whatsapp` | opt-in (consent `whatsapp_reminders`) once a BSP exists |

## 13. Admin (extended)

`admin/practitioners` (*Renamed:* proposed as `admin/providers`; `GET admin/practitioners` is the directory — global entries in full, patient-entered rows as `{id, patientScoped, verification, counts}` only — with `POST admin/practitioners/:id/verify` recording the HPR id; a practitioner merge is the patient-scoped `POST practitioners/:id/merge`, and the admin-side merge exists for organizations only, below), `admin/organizations[/:id/verify]` (plus `POST admin/organizations/:id/merge`), `admin/documents/status` (processing funnel), `admin/support-cases`, `admin/consent-audit`, `admin/abdm/transactions`, `admin/fhir/validation-failures`, `admin/integrations`, `admin/notifications/failures`, `admin/flags[/:key]`, `admin/break-glass` (POST with `reason`, time-boxed, audited, notifies the patient).

## 14. Platform

| Method | Path | Notes |
|---|---|---|
| GET | `meta/flags` | now served from `FeatureFlag` with per-profile evaluation |
| POST | `sync` | offline mutation batch, dispatched by `(entity, operation)`. **Dispatched today:** `dose_event:create` (scope `record_doses`), `patient_medication:create` (`add_medications`), `patient_medication:update` (`edit_medications`, with the field-level disjoint merge on a `rowVersion` conflict); anything else is answered as an `invalid` conflict, never guessed at. `packages/offline-sync` `SYNC_MUTATIONS` == `apps/api` `DISPATCHED_SYNC_MUTATIONS` is asserted by `sync-contract.spec.ts` (ticket 0.16). `observation` and `document_upload_intent` — proposed here from the start — are being added by the offline-sync engineer now (2026-09-06); they land on both sides of the contract in the same change, or the test fails |
| GET | `meta/openapi.json` | the pinned spec (public, no PHI) |

## 15. Deprecations schedule

| Endpoint | Replaced by | Read-only from | Removed |
|---|---|---|---|
| `profiles/current/reports*`, `report-values*` | `diagnostic-reports*` | V2.1 | V2.5 |
| `*-readings` write endpoints | `observations` | V2.2 | V2.5 |
| `profiles/current/documents/authorize-upload` (single object), `documents/:id/*`, `extraction-candidates/:id/*`, `extractions/:id/create-medication` | `patient-documents` + pages, `document-candidates`, `document-extractions` (§5) | V2.0 | V2.5 |
| `profiles/current/checkup-records*` | `encounters` + `observations` | V2.1 | V2.5 |
