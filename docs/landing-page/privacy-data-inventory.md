# Privacy Data Inventory — Medicine Passport by MediDocs

**Session 12 · 2026-08-12 · Status: engineering-verified factual inventory (not legal advice)**

This inventory is built from the *actual* implementation — the Prisma schema, DTOs/validation, API controllers, storage config, cron jobs, and vendor wiring — not from older design docs. Every row cites evidence. It is the factual basis for [privacy-compliance-review.md](privacy-compliance-review.md), the draft [/privacy/](../../apps/marketing-web/app/(en)/privacy/page.tsx) page, and [launch-governance-checklist.md](launch-governance-checklist.md).

Labels used throughout: **[EV]** engineering-verified · **[BD]** business decision required · **[LI]** legal interpretation required · **[CA]** counsel approval required.

---

## 0. Operating legal entity — UNRESOLVED (launch blocker)

Searched the repository, docs, config, and infrastructure for the entity that would operate Medicine Passport as **Data Fiduciary**. Findings: the brand is "Medicine Passport by MediDocs" (`brand.name` / `brand.company_line` = "MediDocs"); the git author and Cloudflare account read "Plaidware Solutions" / "Solutions@plaidware.com's Account". **No formal operating legal entity, company registration, registered address, or country of incorporation is recorded anywhere in the codebase.**

Per SPEC §6, the operating entity is **not** assumed to be Plaidware, the owner personally, or any other company.

> **`LEGAL ENTITY — OWNER DECISION REQUIRED`** — draft legal material uses the placeholder `[LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH]`. This is a hard launch blocker. No registration number, address, or jurisdiction has been fabricated.

---

## 1. Method & evidence base

| Source inspected | Path |
|---|---|
| Data model (≈90 models) | `packages/database/prisma/schema.prisma` (1981 lines) |
| Lead schema (`.strict()`) | `packages/validation/src/leads.ts` |
| Config / env (vendors) | `packages/config/src/index.ts` |
| Field encryption | `apps/api/src/common/crypto.ts` (used by auth, admin-auth, consents, notifications) |
| Consent grant/revoke API | `apps/api/src/modules/consents/consents.controller.ts` |
| Retention jobs | `apps/cron/src/jobs/{retention-cleanup,cleanup-expired-otps,cleanup-expired-sessions,cleanup-abandoned-uploads}.ts` |
| OTP transport (Telnyx) | `apps/api/src/app.module.ts`; `packages/notifications` |
| Object storage (R2) | `packages/object-storage`; `StoredObject` / `ObjectAccessEvent` |
| Sharing (Stage 7) | `SharePackage` / `ShareLink` / `ShareAccessEvent`; [stage7-sharing-security-review.md](stage7-sharing-security-review.md) |
| Marketing analytics/attribution | [analytics-and-attribution.md](analytics-and-attribution.md) |

---

## 2. Master personal-data inventory

Data-subject key: **P** = patient/profile subject, **U** = account holder (user), **CG** = caregiver, **PL** = professional lead, **V** = share visitor. "Storage" is PostgreSQL on Railway unless noted; "encrypted" below means application-level AES-256-GCM (`crypto.ts`), separate from any disk encryption.

| # | Category | Specific fields | Subject | Source | Purpose | Req/Opt | Storage | Processor | Retention (current) | Sharing | Access control | Deletion path | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Phone number | `phoneCiphertext` (AES-GCM), `phoneDigest` (HMAC), `phoneVerifiedAt` | U | User at sign-up | Account identity, OTP login | Required | PG (encrypted) | Telnyx (send only) | **Indefinite** (no account deletion) | No | Owner session | **None** (no account-delete flow) | Raw phone never stored plaintext; lookup by HMAC digest |
| 2 | Email | `User.email` (plaintext, optional) | U | User (optional) | Optional contact | Optional | PG | — | Indefinite | No | Owner session | None | Not used for auth; plaintext |
| 3 | OTP state | `otpHash` (scrypt), `ipDigest` (hash), attempts, counts | U | Login flow | Auth, abuse limiting | Required | PG | Telnyx (code delivery) | **30 days** (cron) | No | System | Auto (30-day cleanup) | Code + IP hashed |
| 4 | Session/device | `tokenHash`, `refreshTokenHash`, `trustTokenHash`, `userAgentDigest`, `lastSeenAt` | U | Login | Session mgmt, "remember device" | Required | PG (hashed) | — | **30 days past expiry** (cron) | No | Owner session | Auto | Raw tokens never stored |
| 5 | Acquisition source | `User.acquisitionSource` = `"website"` \| null | U | `?src=website` first-touch | Marketing attribution | Optional | PG | — | Indefinite | No | System | None | Only `website`; never referrer/UTM/health |
| 6 | Profile identity | `displayName`, `yearOfBirth` (**year only**), `sex?`, `preferredLocale`, `emergencyCard?` (Json, schema-present) | P | User/caregiver | Identify whose medicines these are | name req; rest opt | PG | — | Indefinite | Via share (if selected) | Owner/caregiver scope | Profile soft-delete (`deletedAt`); no hard erase | Full DOB **not** collected — data minimization |
| 7 | Caregiver/dependent links | `CaregiverRelationship` (`invitedPhoneDigest`, `relationship`, `label`), `CaregiverPermission` (scopes) | CG/P | Owner invites | Delegated care | Optional | PG | — | Indefinite | No | Owner grants; scope-checked | Revoke (`revokedAt`); no hard erase | Invited phone stored as **digest** |
| 8 | Medicines | `enteredName`, `patientReason?`, dose `MedicationInstruction` (`originalText` = OCR/shorthand verbatim), status/history `MedicationChange`, `Practitioner` (prescriber name/speciality) | P | Patient/caregiver/OCR | Core passport | Core | PG | — | **Indefinite** | Via share (if selected) | Owner/caregiver scope | Soft-delete only | **Health data** |
| 9 | Dose history | `ScheduledDose`, `DoseEvent` (taken/skipped/…); reminders | P | Patient/caregiver/cron | Adherence, reminders | Derived | PG | — | Doses **24 months** (cron); events indefinite | Via share (recentChanges) | Owner/caregiver scope | Doses auto-pruned; events soft/none | **Health data** |
| 10 | Allergies / conditions | `PatientAllergy` (allergen, severity, reaction), `PatientCondition` | P | Patient/caregiver/doc | Safety context | Optional | PG | — | Indefinite | Via share (if selected) | Owner/caregiver scope | Soft-delete | **Health data** |
| 11 | Vitals / labs | `GlucoseReading` (mg/dL), `CheckupRecord` (BP, weight, HbA1c, cholesterol, waist), `MedicalReport` + `ReportValue` (~30-analyte closed vocab) | P | Patient/caregiver | Personal record | Optional | PG | — | Indefinite | Via share (glucose/checkups if selected) | Owner/caregiver scope | Soft-delete | **Health data**; no diagnostic flags computed |
| 12 | Documents | `StoredObject` (opaque key, sha256, `patient_docs`/`ocr_tmp`), `PrescriptionDocument` (prescription/strip/box/bottle/report photos), `PrescriptionExtraction.rawText` (full OCR text) | P | Patient upload | Evidence, OCR-assisted entry | Optional | **Cloudflare R2** (private) + PG metadata | Cloudflare R2 | Files indefinite; `ocr_tmp`/quarantine **7 days** | Not shared via link (metadata only) | Presigned per-access + audit | Object `delete` status exists; no account-wide erase | OCR is **Tesseract.js, on-device** — no OCR vendor |
| 13 | Share records | `SharePackage.sections`, `ShareLink.tokenHash` (**raw token never stored**), expiry, `ShareAccessEvent` (`ipDigest`, result) | P/V | Patient creates share | Show record to a clinician | Optional | PG | — | Indefinite (link expiry enforced) | The share itself | Owner; token-bearer for read | Revoke (`revokedAt`) | Stage-7 PASS; IP hashed; no internal IDs exposed |
| 14 | Push subscription | `NotificationChannel.addressCiphertext` (encrypted), `endpointDigest` | U | Browser opt-in | Web-push reminders | Optional | PG (encrypted) | Browser push service (user's own; via VAPID) | Indefinite until revoked | No | Owner session | Revoke | Self-signed VAPID — **no push vendor**; medicine name hidden by default |
| 15 | Consent ledger | `Consent` (type, purpose, scope, status), `ConsentEvent` (granted/revoked, actor, context) | P | Consent actions | Record lawful basis | — | PG | — | Indefinite | No | Owner/caregiver | — | Grant/revoke API exists (see §7) |
| 16 | Audit log | `AuditEvent` (hash-chained, digests/coarse context only, **never raw PHI**), `ObjectAccessEvent`, `ConsentEvent` | all | System | Security/audit, integrity | — | PG | — | Indefinite (integrity) | No | Admin (`audit_search` duty) | Retained by design | Append-only, tamper-evident |
| 17 | Professional lead | `name`, `organization`, `role`, `city`, `email?`, `phone?`, `message?`, `consentToContact`, `source`, `status` | PL | Marketing `/for-clinics/` form | B2B follow-up | name/org/role/city req; email OR phone | PG | Cloudflare Turnstile (token verify) | Indefinite | No | Admin/operator | None (manual) | **Never** patient/health data — `.strict()` schema |
| 18 | Marketing analytics | Aggregate pageviews + Core Web Vitals (Cloudflare Web Analytics) | V | Marketing site visit | Traffic measurement | — | Cloudflare (aggregate) | Cloudflare Web Analytics | Cloudflare-managed | — | Cloudflare dashboard | — | No custom events; never on patient/app/share routes |
| 19 | Admin accounts | `AdminUser` (email, `passwordHash`, `mfaSecretCiphertext` AES, duties), `AdminSession` | staff | Internal | Catalog/content governance | — | PG | — | Indefinite | No | Admin RBAC + MFA | — | Not patient data; separate portal |
| 20 | Backups | Daily `pg_dump`, **client-side encrypted before leaving Postgres**, stored in R2; `BackupExecution`/`RestoreTest` | all | Cron | Disaster recovery | — | Cloudflare R2 (encrypted) | Cloudflare R2 | **[BD] undefined** | No | Ops | Backup rotation **[BD]** | Erasure must account for backups |

---

## 3. External processors / sub-processors (evidence-based)

Only vendors the *current* implementation actually uses. "Location" = where processing/storage is established; marked `UNKNOWN — VERIFY` where the region cannot be confirmed from code/config alone.

| Provider | Purpose | Data received | Patient/health data? | Location (established?) | Retention known? | DPA/contract status | Disclosure needed? |
|---|---|---|---|---|---|---|---|
| **Railway** | App hosting + PostgreSQL (primary datastore) | All persisted data (health data at rest in PG) | **Yes** | `UNKNOWN — VERIFY` (Railway region/underlying cloud) [LI] | Until deletion | `UNKNOWN — VERIFY` [CA] | Yes |
| **Cloudflare** | CDN, DNS, WAF, TLS, Turnstile, Web Analytics | Request metadata, IP (transit); Turnstile token; aggregate RUM | Transit only (not health content) | Global edge [LI] | Cloudflare-managed | `UNKNOWN — VERIFY` [CA] | Yes |
| **Cloudflare R2** | Patient document storage + encrypted backups | Uploaded documents (health); encrypted DB backups | **Yes** (documents); backups encrypted | R2 region **[BD] set at bucket creation — VERIFY** | Docs indefinite; `ocr_tmp` 7d | `UNKNOWN — VERIFY` [CA] | Yes |
| **Telnyx** | OTP delivery (voice in prod, SMS capable) + delivery webhooks | **Phone number** + OTP code (transient) | Phone (identity), not health | `UNKNOWN — VERIFY` [LI] | Telnyx-managed | Real account connected; DPA `UNKNOWN — VERIFY` [CA] | Yes |
| **Browser push services** (e.g. FCM/Mozilla/Apple, per user's browser) | Deliver web-push reminders | Encrypted push payload to user's own subscription endpoint | Reminder text (medicine name hidden by default) | User's browser vendor | — | Self-signed VAPID; no MediDocs↔vendor contract | Yes (disclose web push) |

**Not a runtime processor of patient data (verified):**
- **Tesseract.js** — OCR runs **on-device/in-browser**, open-source, no API key, no server round-trip to a vendor.
- **Google Cloud TTS** — used only as a **build-time** tool to generate generic guidance MP3s (not patient-specific, not runtime). No patient data is sent.
- **No LLM/AI service** — `ai_processing` consent type exists in schema, but AI-based processing is **not built** (needs a provider decision, OD-11/12). No patient data goes to any AI vendor.
- **No email provider** — `LEAD_NOTIFY_EMAIL` exists but there is **no email transport wired**; lead notification is a structured log line only.
- **No analytics/tracking vendor beyond Cloudflare Web Analytics** — no GA/Meta/Segment/PostHog/etc.

---

## 4. International / cross-border processing

- **Technical location:** Railway (Postgres + app) and Cloudflare R2 (documents/backups) regions are **not established from code/config**. `UNKNOWN — VERIFY WITH VENDOR/CONTRACT`. Do **not** claim "data stays in India" — it is unverified.
- **Contractual region:** `UNKNOWN — VERIFY` for each vendor.
- **Legal permissibility:** DPDP cross-border provisions are Phase-2 (from 14 Nov 2026) — government may notify restricted countries. `COUNSEL REVIEW REQUIRED` on transfer position and any localization expectation for health data. [LI][CA]

---

## 5. Security safeguards (concrete, verifiable — no "bank-grade" claims)

| Control | Evidence |
|---|---|
| TLS in transit | Cloudflare-terminated HTTPS; HSTS/QUIC in platform config |
| Application-level field encryption (AES-256-GCM) | `crypto.ts`: phone, push endpoint, admin MFA secret |
| Token/secret hashing | Session/refresh/device/share tokens = SHA-256+pepper; OTP = scrypt; passwords = hash; **raw tokens/codes never stored** |
| Private object storage | R2 buckets private; presigned per-access; `ObjectAccessEvent` on every access |
| Share hardening (Stage 7 PASS) | 256-bit tokens, hash-at-rest, server-enforced expiry/revocation, minimized payload, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex` |
| Bot protection | Cloudflare Turnstile on OTP + lead form; fail-closed |
| Rate limiting | Per-IP application limiter (`RateLimitGuard`) |
| Audit logging | Hash-chained `AuditEvent`; daily `verify-audit-chain` job |
| IP minimization | IPs stored as digests only (`ipDigest`) in OTP + share access logs |
| Admin hardening | RBAC duties, MFA (TOTP), maker-checker, lockout |
| Backups + restore tests | Daily encrypted `pg_dump` → R2; `RestoreTest` gates RPO |
| Environment separation | Distinct medpass-dev (staging) / medpass-prod projects |
| Secret management | Secrets only in Railway variables; never committed |

**Not verified / gaps:** disk-level encryption-at-rest of Railway Postgres `UNKNOWN — VERIFY` [LI]; no documented incident-response runbook (see [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md)); no penetration-test attestation.

---

## 6. Consent & user-choice matrix

Backend consent infrastructure is real: `Consent` + `ConsentEvent` ledger; API `GET/POST /profiles/current/consents` and `POST /consents/:id/revoke` (`consents.controller.ts`) record grant/revoke with actor + audit.

| Consent / choice | Who | When shown | Current wording | Recorded where | Withdrawal | Consequence | Gap |
|---|---|---|---|---|---|---|---|
| Core account/product processing | U/P | Sign-up / onboarding | **[VERIFY in patient-web]** whether a standalone DPDP-style notice is shown before processing | `Consent(data_processing)` available | Revoke API | Can't use product | **Notice wording/timing not verified** [EV-gap] |
| Sharing | P | On creating a share | Share creation UI | `Consent(sharing)` + `SharePackage` | Revoke link | Link stops working (future access only) | Bounded wording locked (Stage 7) |
| Caregiver access | P | On inviting a caregiver | Invite UI | `Consent(caregiver_access)` + relationship | Revoke relationship | Caregiver loses access | OK |
| Web-push reminders | U | On enabling reminders | Browser permission + opt-in | `NotificationChannel` | Browser + revoke | No push | Medicine name hidden by default |
| Professional lead contact | PL | On lead form | `consentToContact` (must be `true`) checkbox | `ProfessionalLead.consentToContact` | Email opt-out (manual) [BD] | No follow-up | OK |
| SMS/WhatsApp/email reminders | U | — | **Not implemented** (SMS/WhatsApp channels not built) | `Consent(sms/whatsapp/email)` types exist | — | — | Do not advertise |
| AI processing | P | — | **Not implemented** | `Consent(ai_processing)` type exists | — | — | Do not advertise |
| Analytics | V | Marketing site | Aggregate CWA (no cookies/PII) | Cloudflare | N/A | — | No consent banner today [LI] |

---

## 7. Data-principal rights — actual capability

| Right | Self-service UI | Manual operational path | Backend capability | Gap | Launch blocker? |
|---|---|---|---|---|---|
| Access (know what's held) | Patient sees own data in app | — | Full read within app | No consolidated "export my data" file | P1 |
| Correction / update | Yes (edit medicines, profile, etc.) | — | Update endpoints | Some records are delete+re-add, not edit | No |
| Completion | Yes (add records) | — | Create endpoints | — | No |
| **Erasure** | **No verified account-deletion UI** | **No documented process yet** | `UserStatus.deletion_pending/deleted` enum exists but **no flow implemented**; soft-delete on child records | **No account-wide erasure** | **P0/P1** |
| Withdraw consent | Partial (revoke share/caregiver; consent revoke API) | — | `POST /consents/:id/revoke` | No single consent dashboard | P1 |
| Grievance | No | **No channel provisioned** (no mailbox) | — | **No grievance officer/route** | **P0** |
| Nomination (DPDP) | No | — | — | Caregiver ≠ statutory nominee [LI] | P1 (Phase-3) |

> **Distinguish clearly:** a *legal right* may be fulfilled by an *operational request process*; it does **not** require a self-service product feature. But **erasure has neither a product feature nor an operational process today**, and there is **no grievance channel** — both are blockers.

---

## 8. Retention — verified vs. undefined

| Data | Current retention | Mechanism | Gap |
|---|---|---|---|
| OTP attempts | **30 days** | `cleanup-expired-otps` cron | OK |
| Sessions | **30 days past expiry** | `cleanup-expired-sessions` cron | OK |
| Abandoned/quarantined uploads | **7 days** | `cleanup-abandoned-uploads` cron | OK |
| Scheduled doses | **24 months** | `retention-cleanup` cron | OK |
| **Core health data** (medicines, reports, allergies, conditions, glucose, checkups, dose events) | **Policy: while account active** (owner ruling #2) | soft-delete; **erasure job not yet built** | Implement erasure removal within 30 days of request |
| **Documents in R2** | **Policy: while required by patient/account** (ruling #2) | delete status; **erasure job not yet built** | Implement erasure |
| Professional leads | **Policy: 24 months after last meaningful interaction** (ruling #2) | **not yet built** | Implement lead-retention cron |
| Backups | **Policy: expire within ~90 days; no restore for ordinary use post-deletion** (ruling #2) | daily create; **purge policy not yet enforced** | Enforce backup rotation |
| Audit / security records | **Policy: 24 months** (ruling #2, counsel may adjust) | append-only; **no 24-mo purge yet** | Reconcile integrity vs. purge with counsel |
| Audit log integrity chain | Retained for integrity | append-only | Justifiable; documented |

---

## 9. Children & dependents — current behavior

- The product supports **dependent profiles** and **caregiver** relationships. It stores `yearOfBirth` (year only) and `dependentRelationship` (free text), so it *can approximate* age but **does not**: (a) determine whether a profile subject is a child, (b) verify parent/lawful-guardian status, or (c) distinguish a product "caregiver" from a **lawful guardian**.
- DPDP (Phase-3, from 14 May 2027) requires **verifiable parental/guardian consent** for anyone **under 18** and prohibits targeted advertising to children. MediDocs has no targeted advertising, but has **no verifiable-guardian mechanism**.
- **Flag:** the product currently permits creating/using a profile for a child without guardian verification. This is a **product-remediation design item** (do not build a full age/guardian-verification system in Session 12) and a **Phase-3 readiness** gap. See [privacy-compliance-review.md](privacy-compliance-review.md) §Children.

---

## 10. What the marketing bucket is (do not confuse)

`medidocs-marketing-assets` (R2, `assets.medidocs.app`) holds **PUBLIC marketing content only** — videos, images, audio for the landing page. It contains **no patient data**. Patient documents and backups live in **separate, private** R2 buckets (`patient_docs`, backup objects). These are architecturally distinct.
