# 11 — Security, Privacy and Compliance

Extends `docs/18` and `docs/28`. Starts in Phase 0; it is not a final-stage review.

## 1. Legal frame

Principles consistent with the DPDP Act 2023, the DPDP Rules notified in November 2025, ABDM privacy requirements (Privacy by Design; consent-based exchange; no central repository), and applicable IT/security rules. V1 position stands until counsel signs off (OD-2): disclose cross-border processing, do not claim compliance. V2 adds the ABDM angle: production ABDM requires the hosting architecture to be validated against NHA security/certification requirements (roadmap §28 "Infrastructure"), and the current hosting provider is not a permanent constraint (ADR-V2-010).

## 2. Required capabilities (roadmap §27) and where each lands

| Capability | Today | V2 | Phase |
|---|---|---|---|
| Clear privacy notice | draft legal copy, 14 markers blocking indexed launch | `ConsentNotice` versions; notice shown and versioned at consent time | P0/P6 |
| Purpose-specific processing | 8 consent types | purpose per notification kind, per provider link, per ABDM consent | P6/P8 |
| Consent records and withdrawal | `Consent` + `ConsentEvent`, revoke | + notice version, + ABDM artefacts (separate), + provider links revocable | P6/P8/P11 |
| Account deletion | `erase-account` e2e exists | + provider-link cascade, + ABDM unlink, + R2 object erase job with proof, + backup retention note | P1 |
| Access/correction | export PDF/text; corrections as new rows | `GET profiles/current/export` (JSON + FHIR bundle, step-up) ; correction trail via supersede links | P1/P8 |
| Data minimization | no PHI in logs/URLs/analytics | PHI-free product metrics pipeline; provider reads limited to granted sections | P1 |
| Retention rules | dose retention 24 mo enforced; others pending OD-7 | retention table per class in §6; crons for audit archive (≥ 7 y to R2), operational logs 90 d, ABDM bundle erase | P0 |
| Auditability | hash-chained `AuditEvent`, nightly verify | + provider/org id on every provider read, + break-glass, + record view events for clinical tables | P0/P11 |
| Breach processes | runbooks exist; no tabletop | tabletop exercise in P0; 72-hour notification playbook per DPDP rules | P0 |
| DPO / grievance officer | OD-9 open | prerequisite for V2.4 beta with external users | governance |

## 3. Data separation

| Class | Store | Access |
|---|---|---|
| Identity data | `User`, `AbhaLink` (encrypted numbers, digests) | auth module only |
| Clinical data | clinical tables + R2 `patient-docs` | profile-scoped; provider via links; admin via break-glass only |
| Authentication data | `Session`, `OtpAttempt`, `UserDevice`, `AdminSession` | auth module |
| Analytics data | `ProductEvent`/OTLP events with opaque ids only, no clinical values | analytics duty |
| Audit data | `AuditEvent` chain, `ObjectAccessEvent`, `ShareAccessEvent`, `ConsentEvent` | `audit_search` duty; export to R2 archive |
| Consent data | `Consent`, `ConsentNotice`, `AbdmConsentArtefact` | consent module |

Rule: patient clinical information never enters product-analytics systems (Cloudflare Web Analytics stays marketing-only; app metrics are counts and durations keyed by opaque ids).

## 4. Encryption and keys

- TLS 1.2+ at the edge (exists); private networking Railway-internal (exists).
- At rest: Railway Postgres volume encryption + application-level AES-256-GCM for identity fields. V2 extends field encryption to `AbhaLink.abhaNumberCiphertext`, `EmergencyContact.phoneCiphertext`, `Organization.phoneCiphertext`, and the ABDM gateway key material (in the gateway's own secret store).
- **Keyring (P0-11):** `FIELD_ENCRYPTION_KEYS` = `v1:<key>,v2:<key>`; ciphertext prefixed with the key version; `keyVersion` column on every encrypted field; re-encrypt job; rotation runbook executed on dev in P0, on staging before V2.0, on production annually.
- Backup encryption key custody outside Railway (age/KMS-held private key; runbook R-DR-3).
- Secrets vault: Railway variables stay the runtime store; the source of truth for rotation schedules is [12](12-deployment-and-environments.md) §6; dev/prod R2 and Telnyx credentials separated (open item from V1).

## 5. Authorization

- Patient, caregiver and provider authorization are separate evaluators sharing one engine (`packages/authorization`): RBAC (admin duties, org roles) plus relationship-based access (caregiver scopes, provider links, ABDM consent).
- Exhaustive matrix tests (P0-7) for caregiver scopes; provider link × section tests in P11.
- Admin personnel never see clinical records by default; `privileged_record_access` (break-glass) requires a reason, is time-boxed (60 min), audited with the reason, and notifies the patient in-app.

## 6. Retention table (proposed to counsel under OD-7)

| Class | Online | Archive | Delete |
|---|---|---|---|
| Clinical records | life of account | — | on erase request (+ backups age out in 90 d) |
| Documents (originals) | life of account | — | on erase / document delete |
| Dose events | 24 months online (exists) | aggregate summaries | after 24 mo as events; summaries kept |
| Audit events | 24 months online | monthly encrypted export to R2 ≥ 7 y | never before 7 y |
| Operational logs | 90 d | — | 90 d |
| OTP attempts, sessions, rate buckets | hours–days (exists) | — | crons exist |
| ABDM bundles (copies) | until `dataEraseAt` | — | on erase timer |
| Backups | 90 d (exists) | — | lifecycle rule |
| Professional leads | 24 mo since last interaction (exists) | — | cron exists |

## 7. Sensitive operations requiring step-up (ADR-V2-012)

Caregiver invite/scope change/revoke · share creation · ABHA link/unlink · ABDM consent grant/revoke · provider link revoke · data export · account deletion · notification channel address changes · reconciliation accept (STOP lines) · admin break-glass (TOTP re-verify).

## 8. Security testing and reviews

| Item | When |
|---|---|
| Authz matrix suite green | every CI run from P0 |
| Dependency audit (`pnpm audit` with allowlist) + gitleaks | every CI run |
| ZAP baseline against staging | nightly from P0 |
| Hostile-file upload probing (polyglots, zip bombs, oversized PDFs, malformed images) | P3 |
| External penetration test (api, patient-web, admin-web, provider-web, abdm-gateway) | before V2.4 beta; repeated before V2.8 |
| ABDM security assessment (NHA template) | M8E |
| Threat model refresh | P0 (providers, ABDM), P11 (provider portal), P16 (voice) |
| Vendor DPAs (Telnyx, Railway, Cloudflare, OCR/AI/catalog vendors) | before each vendor processes real data |
| Access review (admin duties, org members, Cloudflare/Railway users) | quarterly |

## 9. Security headers at origin (P0-9)

API: `Strict-Transport-Security` (mirrors edge), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for JSON responses, `Cache-Control: private, no-store` (exists). patient-web/provider-web: CSP with nonces (Next.js middleware), `frame-ancestors 'none'`, `X-Robots-Tag: noindex` (exists for app).

## 10. Privacy by design checkpoints in the definition of done

Every work package answers: what new personal data, which purpose/consent, which retention class, which access path, which audit events, does any of it reach a vendor, and is any of it in a URL/log/metric. Recorded in the PR template (added in P0).
