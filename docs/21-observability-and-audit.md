# 21 — Observability and Audit

## Structured logging

- pino JSON logs everywhere (API, web servers, worker, cron); levels by env; pretty only in dev.
- Every request/job carries a `correlationId` (generated at edge entry, propagated via header → API → queue jobs → provider calls → audit rows).
- **Log hygiene** (spec §12.5): scrubber middleware redacts configured key patterns; never logged: OTPs, tokens, session IDs, phone numbers, medication/patient names, prescription contents, unredacted AI prompts/outputs, presigned URLs. Opaque IDs + digests only. CI log-scan asserts this ([20](20-testing-strategy.md)).
- Log retention 90 days operational (OD-7 for audit-grade retention).

## Metrics (Prometheus-style `/metrics`, protected; scraped/pushed to the monitoring backend)

| Domain | Key metrics (→ §27 mapping) |
|---|---|
| API | latency p50/p95/p99 per route class, error rate, saturation (→ API latency, Railway availability) |
| Jobs | queue depth, processing time, retry count, DLQ size (→ background-job failure rate) |
| Reminders | dispatched/sent/delivered/acknowledged per channel (→ notification-delivery success, reminder acknowledgement, SMS/WhatsApp fallback usage) |
| Sync | sync success, mutation apply rate, conflict rate (→ synchronization success, offline mutation success) |
| Documents | upload success, verification failures, OCR turnaround (→ R2 processing success) |
| Product (PHI-free events) | PWA usage without installation, A2HS rate, notification opt-in, dose-recording rate, shares created, caregiver engagement, OCR correction rate, findings reviewed (→ §27 product metrics) |
| Clinical quality | false-positive alert rate proxies (acknowledgement/override patterns), unsupported-AI-statement audit results |
| Platform | PG connections/slow queries/locks/storage growth, Redis memory/evictions, backup success, restore-test success, cost per active patient (derived) |

Dashboards: Patient-experience, Reminder pipeline, Sync health, Safety-engine quality, Platform health, Cost. Alerts: SLO burn (API availability 99.9% target), DLQ > 0 sustained, reminder delivery success < threshold, backup/restore failure, storage/connection saturation, WAF anomaly spikes, cost-budget breaches.

## Tracing

OpenTelemetry SDK in API and worker; traces exported to the chosen backend (OD-13 — must support OTLP; evaluated against no-PHI-in-spans rule). Span attributes carry opaque IDs only.

## Audit framework (`packages/audit`)

- Append-only `audit_events`, hash-chained (`prev_hash`,`row_hash`) for tamper evidence; chain verified by nightly cron.
- Written in the same transaction as the mutation (API) or via the outbox pattern (worker); audit write failure fails the operation for PHI mutations.
- Event taxonomy (dot-namespaced, defined in `packages/domain`): `auth.*`, `profile.*`, `consent.*`, `caregiver.*`, `medication.*`, `dose.*`, `document.*`, `extraction.*`, `finding.*`, `share.*`, `data.*` (export/deletion), `admin.*`, `ai.*`, `object.*`.
- Every event: actor (user/system/share-visitor), actor type, action, entity, patient profile, correlation ID, context digests (never raw PHI), occurred-at.
- **Patient-visible audit**: patients see accesses to their data (who viewed, when — especially caregiver and share accesses). Admin audit access is itself audited.
- Audit enrichment (worker): geo/device classification from digests, anomaly flags (bulk reads, odd hours) feeding suspicious-activity review.
- Retention ≥ 7 years (OD-7); export to encrypted R2 archive as cold storage; deletion requests preserve legally-required audit while erasing content payloads.

## Edge visibility

Cloudflare security events (WAF blocks, rate-limit hits, bot scores) reviewed via dashboard + periodic export; correlated with application-side `auth.*` anomalies during incident response. Edge logs contain no PHI by construction (no PHI in URLs).

## Operational reports (cron)

Daily: job failures, DLQ contents, reminder pipeline summary, backup status. Weekly: alert-quality summary for clinical review, content freshness, overdue approvals, cost snapshot ([31](31-cost-and-capacity-model.md)).
