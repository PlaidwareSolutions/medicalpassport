# Data Protection Impact Assessment — MedicinePassport V2 (draft v1)

Status: engineering draft, 2026-09-06. Framed on the DPDP Act 2023 and the DPDP Rules 2025 as understood by engineering; counsel confirms the legal reading (OD-2) and the DPO signs (OD-9). Words such as "fiduciary" and "significant" are used descriptively, not as legal conclusions.

## 1. What is being assessed

MedicinePassport is a patient-held medicine reminder and health record for people in India, with (V2) portals through which clinics, pharmacies, laboratories and hospitals *propose* records that the patient accepts or rejects, optional ABDM/ABHA exchange, caregiver access, and time-boxed sharing links. The processing assessed is everything under `apps/api`, `apps/worker`, `apps/cron`, `apps/abdm-gateway` and the three web apps, hosted on Railway with Cloudflare at the edge and Cloudflare R2 for objects.

Why a DPIA: health data of individuals, some of them vulnerable (elderly, chronically ill, low literacy), processed at scale and, via ABDM, exchanged with third parties. That is the profile for which an impact assessment is expected regardless of whether the fiduciary is later classified as "significant".

## 2. Personal data inventory

Grouped by the data classes in docs_v2/11 §3. Storage names are the Prisma models.

| Class | Data | Models | Sensitivity |
|---|---|---|---|
| Identity | phone number (encrypted, digest for lookup), display name, year of birth, sex, preferred language, ABHA number (encrypted), ABHA address | `User`, `PatientProfile`, `AbhaLink`, `ExternalIdentifier` | high (identifier + health context) |
| Authentication | OTP attempts (hashed), sessions, device tokens, admin TOTP secrets (encrypted) | `OtpAttempt`, `Session`, `UserDevice`, `AdminUser`, `AdminSession` | high |
| Clinical | medications, schedules, dose events, allergies, conditions, observations (vitals, glucose, weight), diagnostic reports and results, immunizations, procedures, family history, encounters, health events, documents (photos/PDFs of prescriptions, reports, discharge summaries) and their extracted text and candidates | the clinical tables plus `PatientDocument`, `DocumentPage`, `DocumentExtraction`, `DocumentCandidate`, R2 `patient-docs` | very high |
| Relationships | caregiver relationships and scopes, provider-patient links and granted sections, clinical relationships, emergency contacts (phone encrypted) | `CaregiverRelationship`, `CaregiverPermission`, `ProviderPatientLink`, `ClinicalRelationship`, `EmergencyContact` | high |
| Consent | consent records and events, notice versions, ABDM consent artefacts | `Consent`, `ConsentEvent`, `ConsentNotice`, `AbdmConsentArtefact` | medium (but legally load-bearing) |
| Sharing | share packages, links (peppered token digest), access events (IP, user agent, time) | `SharePackage`, `ShareLink`, `ShareAccessEvent` | high |
| Provider-side | organisation details, members, practitioners, proposals (contain clinical data until accepted/rejected) | `Organization`, `OrganizationMember`, `Practitioner`, `ProviderProposal` | high |
| Safety | rule findings and the patient's actions on them | `SafetyEvaluation`, `SafetyFinding`, `SafetyFindingAction` | very high (derived clinical) |
| Notifications | channel addresses (encrypted), delivery attempts (no content in logs) | `NotificationChannel`, `Notification`, `NotificationAttempt` | medium |
| Audit | hash-chained audit events with actor and profile ids, object and share access events | `AuditEvent`, `ObjectAccessEvent` | medium (metadata about high) |
| Analytics | product events keyed by a peppered profile hash, catalogue-limited properties, no clinical values (P1-7) | `product_events` | low by construction |
| Support/admin | support cases and notes, break-glass grants with reason | `SupportCase`, `SupportCaseNote`, `BreakGlassGrant` | high |
| Marketing | professional leads (name, work e-mail, organisation) | `ProfessionalLead` | low |

Data that is deliberately **not** collected: exact date of birth (year only), postal address, government identifiers other than the ABHA the patient links themselves, payment data, biometric data, precise location.

## 3. Purposes and lawful basis

| Purpose | Basis as proposed | Where consent is captured |
|---|---|---|
| Reminders and the patient's own record | consent at sign-up, notice versioned (`ConsentNotice`) | onboarding, `Consent` type per purpose |
| Notifications on a channel | separate consent per channel and kind | `/profile/notifications`, `NotificationPreference` |
| Caregiver access | patient consent per caregiver, scoped, revocable, step-up on change | `/family` |
| Provider proposals | patient accepts each link (code the patient shows) and each proposal | `/connections`, `/proposals` |
| Sharing links | patient action per share, step-up, expiry, revocation | `/share/new` |
| ABDM exchange | ABDM consent artefacts, separate from app consent (ADR-V2-004) | `/abha/consents` |
| Safety findings (rules) | part of the core service; the patient can dismiss; no automated decision with legal effect | in-product |
| Product metrics | legitimate operation of the service; PHI excluded by construction; opt-out to be decided with counsel | none today |
| Audit | legal/security obligation; not subject to erasure before the retention floor | none |

Children: the service is not offered to children directly; a caregiver holding a child's record is the parent/guardian case the DPDP Rules address, and the verification method for that is an open question for counsel (OD-2, listed in §8).

## 4. Data flows and recipients

- **Edge and hosting:** Cloudflare (TLS termination, WAF, R2 objects), Railway (compute, Postgres, private networking). Both process personal data as processors; region today is the Railway region recorded in docs_v2/12; ADR-V2-010 keeps a region move available if counsel requires residency.
- **OTP delivery:** Telnyx (phone number, OTP message). Under `OTP_TRANSPORT=log` (dev/staging) nothing leaves.
- **WhatsApp/SMS notifications:** BSP and DLT registration pending (OD-10); until then only in-app/push.
- **OCR and document AI:** Tesseract runs inside the worker (no vendor). The `OcrProvider` / `DocumentAiProvider` interfaces (P3-2) allow a vendor later, gated on a DPA (docs_v2/11 §8); none is configured.
- **Malware scanning:** magic-byte checks in-process; an optional ClamAV daemon inside the private network (P3-3); no vendor.
- **Guidance audio:** generated at build time from UI copy with Google Text-to-Speech; no user data is involved.
- **ABDM:** via `apps/abdm-gateway`; data flows only under a consent artefact; copies are erased at `dataEraseAt`.
- **Backups:** encrypted `pg_dump` to R2, key custody outside Railway (R-DR-3).
- **Cross-border:** hosting and edge providers are non-Indian companies; disclosed in the notice per the V1 position; final position awaits OD-2.

## 5. Necessity and proportionality

- Minimisation: year of birth not date; phone as the only identifier; product metrics carry counts and opaque ids only; logs redact PHI (docs/18 §12.5); no PHI in URLs.
- Accuracy: providers propose, patients accept (ADR-V2-009); corrections are new rows with supersede links, never silent edits; provenance on every clinical row (ADR-V2-002).
- Storage limitation: retention table in the companion proposal; crons exist for OTP/session/lead expiry, dose retention 24 months, ABDM bundle erase.
- Rights: export (JSON + FHIR), erase-account with cascade over caregiver links, provider links, ABDM unlink and object erase; correction by adding; consent withdrawal per purpose.
- Transparency: the notice is versioned and shown at consent time; guidance is read aloud in four languages for low-literacy users.

## 6. Risks and controls

Likelihood/severity are engineering estimates: L/M/H/VH.

| # | Risk to individuals | L | S | Controls in place | Residual / action |
|---|---|---|---|---|---|
| R1 | Account takeover via OTP (SIM swap, OTP interception, brute force) | M | H | 5/hour per number and 10/hour per IP, WAF rule, device binding, step-up for sensitive actions (ADR-V2-012), sessions revocable | residual M: consider a second factor for caregivers of many patients (open) |
| R2 | A caregiver or ex-caregiver sees more than granted | M | H | scoped permissions, exhaustive authorization matrix test in CI, revocation immediate, step-up on scope change | residual L |
| R3 | A clinic writes to a record the patient did not want | M | M | providers only propose; patient accepts each; links revocable; every provider read audited with org id | residual L |
| R4 | Share link forwarded or leaked | H | H | time-boxed, peppered token digest, access events shown to the patient, revocation, minimal sections | residual M: patient education copy; consider view-count caps (open) |
| R5 | Uploaded document is malicious or mis-typed | M | M | magic-byte verification, optional ClamAV, quarantine status, pages never served while quarantined, size limits | residual L |
| R6 | Wrong extraction becomes a "fact" | M | H | candidates are never auto-applied; confirmation row by row; provenance keeps the source page; OCR confidence flows into candidate confidence | residual M: Gate 2 quality review before P3 exit |
| R7 | Safety rule gives a wrong or missing alert | M | H | rules versioned with golden tests; findings advisory only; Gate 3 alert-quality dashboard (P9-4) | residual M: clinical lead review (OD-6) |
| R8 | Database or backup exposure | L | VH | volume encryption, field encryption for identifiers with keyring rotation (R-KEY-1), backups encrypted with offline key custody (R-DR-3), least-privilege DB roles (migrator/read-only, ticket 0.22) | residual L |
| R9 | Insider (admin) reads clinical data | L | H | admins have no clinical read by default; break-glass with reason, 60 min, audited, patient notified; audit chain hash-verified nightly | residual L |
| R10 | Analytics leak PHI | L | M | closed event catalogue with a PHI-name guard, peppered profile hash, no free-text properties | residual L |
| R11 | ABDM exchange beyond consent | L | H | separate consent objects, gateway service isolation, erase at expiry, FHIR validation failures logged | residual M until NHA assessment (M8E) |
| R12 | Data kept longer than necessary | M | M | retention proposal; crons for the classes that have a rule | action: OD-7 decision, then remaining crons |
| R13 | Breach not noticed or not notified in time | M | H | audit anomalies, runbook R7, 72-hour playbook in the tabletop pack | action: run the tabletop, appoint DPO |
| R14 | Voice entry (P16) captures bystanders or mis-hears a dose | M | M | text stays primary; voice produces a candidate the patient confirms; no audio retained | design constraint recorded for P16 |

## 7. Measures planned by milestone

| Milestone | Measure |
|---|---|
| P0 | keyring rotation on dev, security headers test, audit off read paths, tabletop, this DPIA v1 |
| P1 | export/erase cascade complete, product metrics PHI-free, retention crons for decided classes |
| P3 | malware scan, provider interfaces with DPA gate, hostile-file probing |
| P6 | notice versioning with per-purpose consent surfaced to the patient |
| P8 | ABDM security assessment (NHA template), gateway penetration test |
| P11 | provider portal threat-model refresh, provider account compromise runbook |
| before V2.4 beta | external penetration test, DPO appointed, counsel sign-off on OD-2/OD-7 |

## 8. Decisions required from outside engineering

1. OD-2: cross-border processing position and whether a region move is required before production ABDM.
2. OD-7: retention windows (companion proposal).
3. OD-9: DPO / grievance officer and the published contact.
4. Verification method for a parent/guardian holding a child's record.
5. Whether product metrics need an opt-out and how it is presented.
6. Vendor DPAs before any OCR/AI vendor, WhatsApp BSP, or catalogue vendor processes real data.

## 9. Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Engineering lead | | | draft prepared |
| DPO | | | |
| Counsel | | | |
| Product owner | | | |
