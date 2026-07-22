# 29 — Production Readiness Checklist

The system must **not** be labeled production-ready until every section passes (spec §30 rule 17). Sign-off owners noted; evidence linked from each item at review time. Stage 11 executes this checklist.

## A. Non-negotiable rules (spec §30) — all verified

- [ ] MVP patient app is a mobile-first PWA; usable without app-store install; works as a normal website; A2HS optional
- [ ] Native apps (when present) use the same backend + clinical services; no separate clinical logic in PWA/native
- [ ] PostgreSQL on Railway is the authoritative system of record; Redis holds no sole-copy data
- [ ] Clinical rules execute only on Railway
- [ ] Cloudflare = edge + private R2 only; patient buckets private; no authoritative data at edge
- [ ] Sensitive responses never publicly cached (probe evidence)
- [ ] PG/Redis private; containers hold no permanent files
- [ ] Every sensitive file access authorized + audited; every clinical finding traceable
- [ ] AI does not invent clinical facts (Gate 6 evidence)
- [ ] Dev/staging contain no real patient data
- [ ] Backups restore-tested (latest `restore_tests` pass)
- [ ] Browser limitations have documented, tested fallbacks; reminders not push-only
- [ ] SMS/WhatsApp/caregiver channels consent-gated

## B. Clinical validation (owner: clinical lead)
- [ ] [34](34-clinical-validation-plan.md) Gates 1–6 passed with recorded evidence
- [ ] Hazard log ([10](10-clinical-hazard-log.md)) reviewed; no unmitigated Catastrophic/High
- [ ] All patient-facing clinical content + translations maker-checker approved; review dates current
- [ ] Warning wording carries the four mandatory statements in all locales

## C. Privacy & consent (owner: legal/DPO)
- [ ] DPDP legal review complete (OD-2); privacy notice published in all locales
- [ ] Cross-border processing disclosed; subprocessor + vendor register current
- [ ] Consent flows verified end-to-end incl. revocation cascades
- [ ] Export + deletion verified against live-like data; retention crons active
- [ ] DPO/grievance contact designated (OD-9); breach-response tabletop completed

## D. Security (owner: security lead)
- [ ] Penetration test completed; criticals/highs remediated
- [ ] AuthZ matrix tests green (every endpoint × role × scope)
- [ ] OTP abuse controls verified (limits, enumeration-safety, provider webhook signatures)
- [ ] WAF + Cloudflare rate limits + Turnstile active and probed; app-level limits stand alone
- [ ] Headers, TLS strict mode, host allowlist verified; admin MFA enforced
- [ ] Secret rotation runbook executed once; gitleaks clean; no secrets in bundles
- [ ] Upload validation (signature/size/quarantine) probed with hostile files

## E. Accessibility & UX (owner: design lead)
- [ ] axe: zero serious/critical across all 41 screens
- [ ] Manual TalkBack + VoiceOver walkthroughs passed; 200% zoom + 320 px passes
- [ ] All four locales reviewed on-device incl. RTL Urdu
- [ ] Comprehension study passed ([34 Gate 4](34-clinical-validation-plan.md))

## F. Reliability & operations (owner: eng lead)
- [ ] Load test at 5× expected launch traffic (API p95 < 500 ms; error rate < 0.5%) — **partial (Stage 11 follow-up):** a real, bounded load test ran against the actual deployed `staging-api.medidocs.app` (autocannon, 20 then 50 concurrent connections, `/readyz`) — 0% errors both times, p97.5 93–160 ms, p99 147–201 ms, well under target. Not a literal 5× reproduction of the 10k-MAU baseline traffic mix (docs/31) — this environment's Railway tier isn't sized for that yet, and a synthetic 5× hammer against shared, real, billed infrastructure wasn't judged proportionate this pass. Box stays unchecked until a real launch-scale test runs against production-sized infrastructure.
- [ ] Reminder pipeline soak: delivery success ≥ target across channels; no duplicate sends under cron restart/replay — not attempted this pass
- [ ] Offline recovery drills: sync after 72 h offline, storage eviction, session revocation purge — not attempted this pass (verified in an earlier session per docs/22 Stage 5, not re-verified now)
- [ ] Worker DLQ + replay verified; Redis-loss recovery drill passed; PG connection-exhaustion behavior verified — not attempted this pass
- [ ] Backup + restore evidence ≤ 30 days old; region-loss game day completed — **partial (Stage 11 follow-up):** backup + restore-test evidence is real and current (see docs/27) — a real `backup_executions`/`restore_tests` pair exists, dated today, with `row_counts_match: true` against the actual deployed database. Region-loss game day not attempted.
- [ ] Dashboards + alerts live ([21](21-observability-and-audit.md)); on-call rota + runbooks ([30](30-operational-runbooks.md)) published — **partial (Stage 11 follow-up):** runbooks are published (docs/30, R1–R13) and a real daily operational-report cron now exists (docs/21) — but this is a structured-log summary within Railway's own log viewer, not a dedicated dashboard tool or real alerting/paging (OD-13's real OTLP backend remains open). No on-call rota exists.
- [ ] Deployment rollback rehearsed — **partial (Stage 11 follow-up):** the "roll forward" path (commit a fix → push → Railway auto-redeploys from the new commit) was exercised for real dozens of times this session, always successfully — this is this project's actual, proven recovery mechanism. Rolling back to a specific *older* deployment without a new commit is a real Railway dashboard feature but isn't exposed by the CLI (confirmed: `railway redeploy`/`railway deployment redeploy` only ever target the *latest* deployment) — not rehearsed, documented honestly in docs/30 R10 rather than claimed.

## G. Browser compatibility (owner: frontend lead)
- [ ] Full matrix pass ([32](32-browser-capability-and-fallback-matrix.md)): Chrome Android, Samsung Internet, Safari iOS, desktop Chrome/Edge (+ Firefox best-effort) — **partial (Stage 11 follow-up):** real engine-level compatibility verified against the actual deployed `staging-app.medidocs.app` across all three browser engines (Chromium, Firefox, WebKit via Playwright) — page load, service worker registration/activation, IndexedDB, PWA manifest validity, and the login form all passed cleanly on every engine, zero page errors. This is engine coverage, not the real-device matrix this line actually requires (no real Android/Samsung Internet/iOS Safari device access this pass) — box stays unchecked until real devices are tested.
- [ ] All 16 mandatory PWA test cases green ([20](20-testing-strategy.md)) — not run this pass
- [ ] Tier B and Tier C degradation verified on real devices

## H. Cost controls (owner: eng lead)
- [ ] Budgets + alerts configured per [31](31-cost-and-capacity-model.md); quotas active (upload, storage, AI, OCR, reminders, retries, abuse)
- [ ] Non-production shutdown policies active
- [ ] Cost-per-active-patient dashboard live

## Launch decision

Go/no-go review with clinical, legal, security, design, and engineering owners; decision + evidence recorded in `docs/validation/launch-<date>.md`. Any regression on section A blocks launch outright.
