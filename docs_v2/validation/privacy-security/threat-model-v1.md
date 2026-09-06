# Threat model v1 — MedicinePassport V2 (draft)

Status: engineering draft 2026-09-06 for the Architecture Board (docs_v2/11 §8 "threat model refresh, P0: providers, ABDM"). STRIDE per trust boundary; each threat names the control that exists in code, or the ticket that adds it. Refreshes are due at P11 (provider portal in production) and P16 (voice).

## 1. System and trust boundaries

```
 Patient phone (PWA)  ──┐
 Caregiver phone (PWA) ─┤  B1: public internet → Cloudflare edge (TLS, WAF, rate rule)
 Clinic browser ────────┤
 Share-link recipient ──┘
            │
            ▼
   B2: edge → Railway origin (api :4000, patient-web, admin-web, provider-web)
            │
      ┌─────┴─────────────────────────────┐
      │ api ── worker ── cron  (private network)   B3: services → Postgres, R2
      │        │
      │   abdm-gateway ───────────────── B4: gateway → ABDM sandbox/production (NHA)
      └───────────────────────────────────┘
   B5: api → Telnyx (OTP), future BSP (WhatsApp), future OCR/AI vendor
   B6: operators (Railway/Cloudflare consoles, admin-web)
```

Trust levels: patient (owner of one or more profiles), caregiver (scoped delegate), provider member (org-scoped, proposes only), share recipient (anonymous with a token), admin (duties, no clinical read), operator (infrastructure), ABDM gateway (mutual TLS/keys with NHA).

## 2. Assets

1. Clinical records and documents (confidentiality, integrity).
2. Identity: phone numbers, ABHA numbers (confidentiality).
3. Session and OTP material (integrity of authentication).
4. The audit chain (integrity, non-repudiation).
5. Field-encryption keys, share pepper, session pepper, backup key (confidentiality).
6. Safety-rule content and versions (integrity; a tampered rule harms patients).
7. Availability of reminders (a missed dose is a patient-safety event).

## 3. Threats by boundary (STRIDE)

### B1/B2 — clients to API

| Threat | Category | Control today | Gap / ticket |
|---|---|---|---|
| OTP brute force or enumeration | Spoofing | 5/h per number, 10/h per IP (`@RateLimit`, Postgres buckets), WAF rule at the edge, OTP hashed with pepper, constant-time compare, 30 s resend window | second rate rule on the `medicinepassport.app` zone needs the Pro plan (docs_v2/12) |
| Session theft (XSS, device loss) | Spoofing | httpOnly SameSite cookies per app (`medpass_session`, `medpass_provider_session`), CSP with nonces in the web apps, device binding, step-up for sensitive actions, revoke-all | security headers regression test (ticket 0.19, in progress) |
| CSRF on state-changing routes | Tampering | SameSite=Lax cookies, JSON bodies, CORS allowlist per environment | — |
| IDOR across profiles | Elevation | every service resolves `profileId` from the session, never from the body; authorization engine with matrix snapshot test in CI (`packages/authorization`) | keep the snapshot test additive-only; review on every new controller |
| Caregiver scope creep | Elevation | scope evaluated per section; step-up on scope change; exhaustive matrix test | — |
| Provider reads beyond granted sections | Information disclosure | `ProviderPatientLink.sections`; snapshot endpoint filters by section; audit row with org id on every read | provider-web threat refresh at P11 |
| Share token guessed or replayed after expiry | Spoofing | 256-bit token, peppered digest at rest (`SHARE_TOKEN_PEPPER`), expiry and revocation checked per request, access events | view-count cap is an open product question (DPIA R4) |
| Hostile upload (polyglot, script in PDF, oversized) | Tampering | content-type allowlist, size limits, magic-byte scanner and optional ClamAV before OCR, quarantine status, pages not served while quarantined (P3-3, in progress) | hostile-file probing suite (docs_v2/11 §8, P3) |
| Abuse of read endpoints to stall the audit lock | Denial of service | audit writes for `*_viewed` actions are queued and batched off the request (ticket 0.18, in progress) | — |
| Voice entry mis-hearing (P16) | Tampering | text primary; voice yields a candidate the patient confirms; nothing is written from audio directly | design rule; test at P16 |

### B3 — services to data

| Threat | Category | Control today | Gap / ticket |
|---|---|---|---|
| Database credential leak | Information disclosure | Railway private network, credentials only in Railway variables, gitleaks in CI, field encryption for identifiers, backups encrypted with an offline key | least-privilege roles: migrator (DDL) vs runtime vs read-only (ticket 0.22, in progress) |
| Silent tampering of clinical rows | Tampering | append-only pattern with supersede links, provenance on every row (ADR-V2-002), audit chain | — |
| Audit chain broken or rewritten | Repudiation | SHA-256 chain, global advisory lock on append, nightly `verify-audit-chain`, INC-2026-001 remediation | monthly encrypted archive export (retention row 4) |
| Object storage listing or hot-linking | Information disclosure | R2 private buckets, objects served only through the API with authorization and `ObjectAccessEvent`; `Cache-Control: no-store` | — |
| Key loss | Denial of service | keyring with versioned ciphertext (`k<n>:`), rotation job and runbook R-KEY-1, backup key custody R-DR-3 | execute R-KEY-1 on staging before V2.0 |
| Queue poisoning (malformed job payloads) | Tampering | jobs are typed and validated by processor; dead-letter table; retry with backoff | — |

### B4 — ABDM gateway

| Threat | Category | Control today | Gap / ticket |
|---|---|---|---|
| Forged callback from "ABDM" | Spoofing | callbacks accepted only from the gateway service with `ABDM_INTERNAL_TOKEN`; gateway validates NHA signatures/keys | production keys and mutual auth at M8A; R-ABDM-1 runbook |
| Data pulled without a valid artefact | Elevation | every fetch is tied to an `AbdmConsentArtefact` with scope and expiry; bundles carry `dataEraseAt` | NHA security assessment M8E |
| Bundle content injects into the record | Tampering | FHIR validation with failure log; nothing is written until the patient confirms row by row (ADR-V2-009) | — |
| Gateway compromise reaches patient data | Elevation | gateway holds no clinical store; talks to the API with a scoped token | R-ABDM-2/3 runbooks |

### B5 — vendors

| Threat | Category | Control today | Gap / ticket |
|---|---|---|---|
| OTP interception at the SMS provider | Information disclosure | OTP is single-use, 10 minutes, rate-limited; step-up for sensitive actions means an OTP alone does not export or share | DLT registration (OD-10) |
| Document vendor retains PHI | Information disclosure | no vendor configured; `OcrProvider`/`DocumentAiProvider` adapters gated on a DPA and an env switch | vendor contract checklist (P3-2, in progress) |
| Telemetry backend receives PHI | Information disclosure | PHI-free logging policy, product-event catalogue with a name guard | OD-13 backend choice |

### B6 — operators and admins

| Threat | Category | Control today | Gap / ticket |
|---|---|---|---|
| Admin reads a patient record | Information disclosure | no clinical duty by default; `privileged_record_access` break-glass with reason, 60 minutes, TOTP re-verify, audited, patient notified | R-BG-1 review runbook |
| Compromised Railway or Cloudflare account | Elevation | tokens least-scoped and rotated 90 days (docs_v2/12 §6), IaC plan before apply, `checkSuites` gate so an unreviewed commit cannot deploy | production `checkSuites` still to apply; quarterly access review |
| Malicious or mistaken deploy | Tampering | CI gates (typecheck, lint, OpenAPI contract, authz snapshot, e2e), additive-only migrations (ADR-V2-007), rollback runbook R10 | — |
| Secret committed to git | Information disclosure | gitleaks on every run; secrets only in `.dev-data/secrets.env` locally and Railway variables remotely | — |

## 4. Abuse cases worth a dedicated test

1. Caregiver with revoked access still holds an open PWA tab — every request must 403 after revocation (matrix + e2e exists for the API; add a browser case).
2. Provider member removed from an organisation mid-session — provider session must lose the org scope on the next request.
3. Share link opened after the patient erased the account — must 404, not leak the tombstone.
4. Two devices record the same dose offline and both replay — one event, one conflict record, no double count (offline-sync suite).
5. A PDF with `/JavaScript` uploaded as a lab report — quarantined; review screen shows the quarantine copy; page download 404s (P3-3 e2e).

## 5. Residual risks accepted for now

- Single OTP factor for all patient roles (DPIA R1). Accepted until caregiver-of-many patterns appear in pilot data.
- Cloudflare Free plan allows one rate-limit rule per zone; the second zone relies on application limits alone until the plan decision (docs_v2/16).
- No external penetration test yet; scheduled before V2.4 beta.

## 6. Review log

| Date | Trigger | Outcome |
|---|---|---|
| 2026-09-06 | P0 refresh (providers, ABDM) | draft v1 |
