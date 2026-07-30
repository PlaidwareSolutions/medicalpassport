# 14 — API Contracts

Base: `https://api.example.com/v1`. OpenAPI generated from NestJS decorators is the machine-readable contract (`pnpm --filter api openapi` → `packages/api-client` codegen); this document defines the conventions and surface.

## Global conventions

- **Auth:** opaque bearer session token (httpOnly cookie for web, Authorization header for native). All endpoints authenticated except: OTP request/verify, health, share-link access, feature flags (public subset), PWA version.
- **Active profile:** PHI endpoints require `X-Profile-Id`; authorization = owner ∨ caregiver-with-required-scope ∨ admin duty, enforced in `packages/authorization`, evaluated per request (revocation is immediate).
- **Idempotency:** all sensitive writes accept `Idempotency-Key` (uuid). Offline mutations carry `clientMutationId`. Replays return the original result with `Idempotent-Replay: true`.
- **Optimistic concurrency:** mutable patient records return `rowVersion`; updates require it; mismatch → `409 CONFLICT` with server state (client merges per [15](15-offline-sync-strategy.md)).
- **Errors:** RFC 7807 problem+json: `{type, title, status, code, correlationId, errors[]}` — no PHI, no stack traces. Stable `code` strings from `packages/domain`.
- **Pagination:** cursor-based `?cursor=&limit=` (max 100), response `{items, nextCursor}`.
- **Validation:** Zod schemas shared client/server via `packages/validation`; API re-validates everything.
- **Cache headers:** all authenticated/PHI responses `Cache-Control: private, no-store`. Only versioned static assets and public catalog metadata are cacheable ([26](26-cloudflare-edge-and-r2-architecture.md)).
- **Rate limits:** layered Cloudflare + application (per-IP, per-account, per-device); `429` with `Retry-After`. Sensitive flows (OTP, share access, search, export, AI) have per-endpoint budgets ([spec §12.3]).
- **Audit:** every PHI read/write emits audit events; the acting caregiver is always distinguishable from the patient.
- **Compatibility:** contract consumed identically by PWA and future native apps; breaking changes require `/v2`.

## Surface

### Auth & sessions
| Endpoint | Notes |
|---|---|
| `POST /auth/otp/request` | `{phone, purpose, turnstileToken?}` → `202` always (enumeration-safe). Limits: 5/hour/phone, resend cooldown. Turnstile verified server-side when challenged. |
| `POST /auth/otp/verify` | `{phone, code, deviceInfo, rememberDevice}` → session + refresh tokens. 5 attempts/OTP then invalidated. `423` on lockout. `rememberDevice` (default `true`) mints a long-lived device-trust cookie (ADR-14, [24](24-open-decisions-and-assumptions.md)). |
| `POST /auth/refresh` · `POST /auth/logout` | Rotate / revoke. Logout also revokes this device's trust (ADR-14). |
| `POST /auth/device-login` | `{phone}` + the httpOnly trust cookie → session, no OTP. `401 device_not_trusted` (generic, no enumeration) if the cookie is missing/revoked/for a different phone. |
| `GET/DELETE /auth/devices` | List + revoke devices (screen 35) — device-centric, not session-centric: a trusted device with no currently-live session still appears here and stays revokable. Revoking a device kills its trust *and* any live session on it. |

### Profiles, caregivers, consent
| Endpoint | Notes |
|---|---|
| `GET/POST/PATCH /profiles` | Own + authorized profiles; PATCH uses rowVersion. |
| `POST /profiles/:id/dependents` | Caregiver-created dependent profile + full-management relationship + consent record. |
| `GET/POST /profiles/:id/caregivers` · `PATCH/DELETE /caregivers/:relationshipId` | Invite (phone + scopes + optional expiry), scope changes, revoke. All consent-backed + audited. |
| `POST /caregivers/accept` | Invited user accepts (OTP-verified account). |
| `GET/POST /profiles/:id/consents` · `POST /consents/:id/revoke` | Purpose-bound consent management; revocation cascades (e.g. disables SMS channel). |
| `GET/POST/PATCH /profiles/:id/allergies` · `/conditions` | Mutations trigger safety re-evaluation (Stage 6). |

### Medication catalog & patient medications
| Endpoint | Notes |
|---|---|
| `GET /catalog/products?q=` | Search brand/generic/ingredient incl. aliases; non-PHI; rate-limited; `Cache-Control: private, max-age=300` (per-user cache only). |
| `GET /catalog/products/:id` | Product + ingredients + strengths + content availability. |
| `GET/POST /profiles/:id/medications` | List (filter by status) / create. Create body: product ref *or* free-text `enteredName`, instructions (typed), prescriber, `patientReason`, source, optional `prescriptionId` (inherits that prescription's doctor when no prescriber is typed). Idempotency-Key required. |
| `GET/PATCH/DELETE /medications/:id` | rowVersion concurrency; status transitions validated (`current→paused|completed|stopped`…); soft delete; every change appends `medication_changes` + audit. `prescriberName: ""` clears the prescriber link; `prescriptionId: null` unlinks the prescription. |
| `GET /medications/:id/history` | Change log. |

### Prescription records
| Endpoint | Notes |
|---|---|
| `GET/POST /profiles/:id/prescriptions` | List (newest visit first, with file/medicine counts) / create. All body fields optional: `practitionerName` (deduped per profile, case-insensitive), `prescribedAt`, `notes`. Scopes: `view_profile`/`edit_profile`. |
| `GET/DELETE /prescriptions/:id` | Detail (attached documents + linked medicines) / soft delete. Deleting never cascades — documents and medicines keep their `prescription_id` and stay intact; reads stop surfacing the deleted parent. |
| `POST /prescriptions/:id/medications` | Links an already-added medicine as evidence; fills in the prescription's doctor only if the medicine names none. |

### Documents & uploads (Stage 3)
`POST /profiles/:id/documents/authorize-upload` (type/size limits declared; optional `prescriptionId` attaches the upload to a prescription record — that path requires `edit_profile`, the medication-scan path `add_medications`; returns pending doc + presigned PUT, expiry ≤ 10 min) · `POST /documents/:id/complete` (server verifies object: signature, size, checksum; idempotent) · `GET /documents/:id/download-url` (authorized, short-lived, audited) · `DELETE /documents/:id`. `complete`/`download-url` carry only a document id, so they accept either the medication or profile scope — a deliberate, documented broadening. Upload limits: images ≤ 10 MB, PDF ≤ 20 MB; JPEG/PNG/HEIC/PDF only.

### Prescriptions & extraction (Stages 3/8)
`POST /documents/:id/process` → extraction job · `GET /extractions/:id` (status + candidates with confidence) · `POST /extractions/:id/candidates/:candidateId/confirm|correct|reject` (records confirmer + timestamp; original immutable) · `POST /extractions/:id/create-medications` (only from confirmed candidates).

### Scheduling, doses, reminders (Stage 4)
`GET/PUT /medications/:id/schedule` (taper requires `taperSource`) · `GET /profiles/:id/timeline?date=` · `POST /doses/:scheduledDoseId/events` + `POST /profiles/:id/doses/events` (PRN; `clientMutationId` for offline) · `POST /notifications/:id/ack|snooze` · `GET/PUT /profiles/:id/notification-preferences` (channel consent enforced).

### Offline synchronization (Stage 5)
| Endpoint | Notes |
|---|---|
| `POST /sync` | Batch: `{cursor, mutations[{clientMutationId, entity, operation, payload, baseRowVersion}]}` → `{applied[], conflicts[], changes[], nextCursor}`. Per-mutation idempotency via `offline_mutations`; conflict rules per entity in [15](15-offline-sync-strategy.md); revoked session/permission → `401/403` with client-purge directive. |

### Safety (Stage 6)
`POST /profiles/:id/safety/evaluate` (idempotent per input snapshot) · `GET /profiles/:id/safety/findings?status=` · `POST /findings/:id/actions` (`acknowledge|note|reviewed_with_professional`) — never deletes findings. Responses include full traceability block.

### Explanations & translation (Stage 8)
`GET /medications/:id/explanation?level=simple|more|clinical&locale=` — serves approved content or AI-simplified approved content, marked with provenance; the no-data fallback string when absent. `POST /translations/preview` (admin).

### Sharing (Stage 7)
`POST /profiles/:id/shares` (sections, expiry ≤ 30 days, method, optional OTP verification) · `GET /shares` · `POST /shares/:id/revoke` · Public: `GET share.example.com/s/:token` (no-store, token hashed lookup, expiry+revocation enforced, access evented) · `GET /profiles/:id/visit-summary` (doctor-visit mode data) · `GET /shares/:id/accesses`.

Section keys: `medications`, `allergies`, `conditions`, `recentChanges`, `concerns`, `glucoseReadings`, `checkups`, `prescriptions`. An omitted key on **create** defaults to included; an omitted key on a **stored** share (i.e. one created before that section existed) is treated as excluded — new sections never retroactively widen live links. The three clinical-record sections each cover the last 90 days: glucose returns an aggregate plus the 10 most recent readings, check-ups the last 5 with unmeasured metrics left null, and prescriptions **metadata only** — no document ids or download URLs, since the public path is unauthenticated.

### Data rights
`POST /profiles/:id/export` → async; `GET /exports/:id` → status + short-lived download URL (re-auth required). `POST /profiles/:id/deletion-request` (re-auth; grace period; cancellable) · `DELETE /deletion-requests/:id`.

### Admin (`admin` duty + stronger auth; separate rate class)
Catalog CRUD with maker-checker (`POST /admin/catalog/...`, `POST /admin/approvals/:id/decide`), content/translation review, rule management + versions, audit search (audited itself), incident tools, job replay (`POST /admin/jobs/:id/replay`).

### Platform
`GET /healthz` (liveness, no deps) · `GET /readyz` (DB/Redis checks) · `GET /meta/version` (PWA update checks) · `GET /meta/flags` (feature flags, scoped) · `POST /webhooks/{sms|whatsapp|ocr}` (signature-verified, idempotent by provider event ID, replay-protected).

## Contract testing

`packages/api-client` is generated from OpenAPI; contract tests pin the schema (breaking-change detection in CI). The same suite must pass against native clients in Phase 2 ([20-testing-strategy](20-testing-strategy.md)).
