# 14 — Observability, Administration and Operations

Extends `docs/21` and `docs/30`. Today: pino JSON logs with redaction, correlation ids end-to-end, hash-chained audit verified nightly, a daily operational-report cron read in Railway's log viewer. No metrics backend, no alerting, no on-call (OD-13 open).

## 1. Observability backend (P0-13, resolves OD-13)

Choose an OTLP-compatible backend (managed; PHI never sent: attributes are opaque ids, counts, durations, error codes). `packages/observability` exports traces, metrics and logs via OTLP; Railway's log drain keeps raw logs as backup. Correlation: `correlationId` on every span/log; ABDM exchanges add `abdmRequestId`/`abdmTransactionId`.

## 2. SLIs and alerts (roadmap §32)

| SLI | Source | Alert (page) | Alert (ticket) |
|---|---|---|---|
| Request latency p95 per route group | api spans | p95 > 1 s for 10 min | p95 > 500 ms for 30 min |
| API 5xx rate | api | > 1 % for 5 min | > 0.5 % for 30 min |
| Failed notifications (`NotificationAttempt.failed`) | worker/cron | dose_reminder failures > 2 % in 15 min | any channel > 5 %/h |
| OCR / extraction failure rate | worker | > 20 % in 1 h | > 5 %/day |
| Extraction confidence distribution shift | worker | — | median drops > 0.1 week-over-week |
| FHIR validation errors | `FhirValidationFailure` | outbound failures > 0 in prod | inbound > 10 %/day |
| ABDM integration failures | `AbdmTransaction` | error rate > 5 % over 15 min; callback verification failure > 0 | consent-expiry job failure |
| Authentication failures | api | OTP verify failure spike 5× baseline | admin lockouts > 3/h |
| Consent failures | api | any consent write failure | — |
| Device ingestion | api batch | — | duplicates rejected > 10 %/day |
| Queue lag (oldest queued job age) | `BackgroundJob` | > 5 min for `notification_dispatch`, > 15 min for `document_extract` | > 60 s p95 sustained (ADR-V2-006 trigger) |
| DLQ size | `DeadLetterJob` | > 0 for `abdm_*` | > 0 any |
| Backup freshness / restore-test | cron rows | backup > 26 h old; verify failed | restore-test failed |
| Audit chain | verify cron | any new break | — |
| Cost per active patient | billing exports + metrics | — | > budget by 20 % |

Paging goes to an on-call rota (WS18) that exists from V2.0 with at least two people; runbook link on every alert.

## 3. Administrative platform (roadmap §31) — additions to `admin-web`

| Page | Data | Duty |
|---|---|---|
| Users (exists) | — | `users_view` |
| Providers / Organizations (new) | `Organization`, `OrganizationMember`, `ProviderPatientLink` counts; verify HFR/HPR | `provider_admin` |
| Facilities directory (new) | global `Organization` entries | `provider_admin` |
| Document processing (new) | funnel: uploaded → classified → extracted → confirmed; failures by engine | `operations_view` |
| Support cases (new) | `SupportCase`; break-glass request | `support_cases` |
| Consent audit (new) | `ConsentEvent` + `AbdmConsentArtefact` timelines by opaque id | `audit_search` |
| Security audit (exists, extended) | audit search + break-glass log | `audit_search` |
| ABDM transactions (new) | `AbdmTransaction` explorer | `abdm_operations` |
| FHIR validation failures (new) | `FhirValidationFailure` | `fhir_view` |
| Integrations (new) | adapter health: OCR/AI/catalog/interaction/BSP/lab APIs | `operations_view` |
| Notification failures (exists in operations, split out) | by channel/kind | `operations_view` |
| Configuration / feature flags (new) | `FeatureFlag` editor with audit | `super_admin` |
| Incidents (exists) | DLQ replay, share revoke | `incident_response` |
| Rules / findings (exists) | + Gate 3 alert-quality dashboard | `rules_view` |

Admin personnel never see clinical values on these pages; ids are opaque; break-glass is the only path and is time-boxed and audited.

## 4. Runbooks (extends R1–R13)

New: R-KEY-1 field-key rotation · R-DR-3 backup key custody and restore with the offline key · R-ABDM-1 gateway credential rotation · R-ABDM-2 callback outage (replay from `AbdmTransaction`) · R-ABDM-3 consent-expiry erase failure · R-DOC-1 extraction provider outage (fallback to Tesseract, queue drains) · R-PROV-1 provider account compromise (revoke org members, expire links, notify patients) · R-MIG-1 backfill resume · R-MIG-2 sunset migration go/no-go · R-REGION-1 region move · R-BG-1 break-glass review.

## 5. Support and operations (WS18, resolves OD-17)

A support channel is defined before V2.4 external beta: in-app "Help → Contact" (creates a `SupportCase`), a support mailbox on `medicinepassport.app`, and a phone/WhatsApp line for the pilot cohort. Provider support has its own queue. Knowledge base: the help screen's speakable FAQ grows from 20 to cover documents, measurements, sharing with a clinic, and ABHA.

## 6. Product analytics (roadmap §33), PHI-free

Events: registration, onboarding completion, source channel, clinic/pharmacy referral, medicine added, prescription uploaded, first test recorded, first measurement, caregiver added, doctor shares, caregiver invitations, clinic onboardings, pharmacy onboardings, ABHA linked, records discovered/linked/retrieved, consent flows completed. Emitted from services as OTLP events with opaque ids and no clinical values; dashboards in the observability backend; weekly report cron replaces the unbuilt "weekly" operational report.
