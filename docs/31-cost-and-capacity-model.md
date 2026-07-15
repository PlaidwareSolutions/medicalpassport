# 31 — Cost and Capacity Model

Guardrail (spec §28): **do not weaken clinical safety to reduce cost.** Cost controls throttle abuse and waste — never patient-critical reminders or safety evaluations; those alert operators before they throttle patients.

## Cost lines (modeled per environment; figures are planning placeholders to be replaced with measured data)

| Line | Driver | Notes / initial assumption (10k MAU scenario) |
|---|---|---|
| Railway API compute | replicas × size | 2 × small instances baseline; scale on p95 latency |
| Railway patient-web compute | SSR traffic | 2 × small; heavy static offload to CDN |
| Railway admin-web compute | internal traffic | 1 × small |
| Railway worker compute | queue volume (reminders dominate) | 1–2 × small; concurrency-capped |
| Railway cron execution | schedule table ([25](25-railway-deployment-architecture.md)) | minutes/day; near-negligible |
| PostgreSQL | storage + compute | dose events + audit dominate growth; 24-mo online dose retention |
| Redis | memory | queues + short-TTL keys; small instance |
| Network | egress via Cloudflare proxy | images kept in R2 (zero egress fees to internet via Cloudflare) |
| Cloudflare plan | Pro/Business tier for WAF+rate limiting features | evaluate at launch |
| R2 storage | prescription images (~1–2 MB each, compressed derivatives) | lifecycle rules cap tmp/exports |
| R2 operations | uploads + presigned reads | Class A/B ops budgeted per patient/month |
| WAF / rate limiting | plan-included + usage rules | |
| OTP + SMS | per-message (India DLT-registered templates) | biggest variable cost with WhatsApp; capped per user/day |
| WhatsApp | per-conversation (BSP) | preferred over SMS where consented (cheaper per message set) |
| Push notifications | free (web push/FCM) | |
| OCR | per-page | cache results; retry caps; per-user daily quota |
| AI | per-token | cached per (content version, locale, level); per-profile budget |
| Clinical-data licensing | OD-3/4 vendor contracts | likely the largest fixed cost line — priced during selection |
| Monitoring/logging | volume-based (OD-13) | sampling on success paths; full on errors |
| Backups | R2 storage + cron compute | encrypted exports, lifecycle-aged |
| Native build/release (Phases 2–3) | Play/App Store fees, build minutes, device lab | deferred |

**North-star: cost per active patient** — dashboard from day one; §27 metric.

## Enforced limits (implementation, spec §28)

| Control | Mechanism |
|---|---|
| Upload limits | size/type at authorize-upload + app validation; per-user daily upload quota |
| Storage quotas | per-profile document quota (soft warn, hard cap with support path) |
| AI limits | per-profile daily budget + global budget; degrade to approved content verbatim (never skip safety) |
| OCR limits | per-user daily pages; queue rate caps |
| Reminder limits | per-profile channel caps with operator alert **before** patient-critical throttling; dedupe keys stop runaway sends |
| Queue concurrency | BullMQ per-queue concurrency + rate limits |
| DB connection limits | pool sizing per replica; PgBouncer headroom |
| Retention policies | crons purge tmp objects, expired exports, aged operational data |
| Cost alerts | Railway usage alerts + provider spend alerts + weekly cost report ([21](21-observability-and-audit.md)) |
| Non-production shutdown | dev/staging scale-to-zero or nightly sleep schedules |
| Retry limits | bounded retries + DLQ everywhere (no infinite retry spend) |
| Abuse limits | Cloudflare + app rate limits, Turnstile, per-account/device budgets |

## Capacity planning

Baseline assumptions (validated against real telemetry post-launch): 10k MAU · 5 medications/patient · 3 reminders/day/patient → ~1.5 M reminder dispatches/month (mostly push/in-app; SMS fallback ~15%) · ~2 uploads/patient/month → ~20k OCR pages · dose events ~1 M rows/month (~150 MB/yr with indexes) · audit ~3× dose volume. Scaling levers in order: worker concurrency → API replicas → PG size → queue sharding. Load test at 5× baseline is a launch gate ([29](29-production-readiness-checklist.md)).

## Review cadence

Weekly cost snapshot in ops report; monthly variance review against this model; model figures replaced by measured data after the first month of staging soak and again at launch.
