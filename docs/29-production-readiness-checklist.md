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
- [ ] Load test at 5× expected launch traffic (API p95 < 500 ms; error rate < 0.5%)
- [ ] Reminder pipeline soak: delivery success ≥ target across channels; no duplicate sends under cron restart/replay
- [ ] Offline recovery drills: sync after 72 h offline, storage eviction, session revocation purge
- [ ] Worker DLQ + replay verified; Redis-loss recovery drill passed; PG connection-exhaustion behavior verified
- [ ] Backup + restore evidence ≤ 30 days old; region-loss game day completed
- [ ] Dashboards + alerts live ([21](21-observability-and-audit.md)); on-call rota + runbooks ([30](30-operational-runbooks.md)) published
- [ ] Deployment rollback rehearsed

## G. Browser compatibility (owner: frontend lead)
- [ ] Full matrix pass ([32](32-browser-capability-and-fallback-matrix.md)): Chrome Android, Samsung Internet, Safari iOS, desktop Chrome/Edge (+ Firefox best-effort)
- [ ] All 16 mandatory PWA test cases green ([20](20-testing-strategy.md))
- [ ] Tier B and Tier C degradation verified on real devices

## H. Cost controls (owner: eng lead)
- [ ] Budgets + alerts configured per [31](31-cost-and-capacity-model.md); quotas active (upload, storage, AI, OCR, reminders, retries, abuse)
- [ ] Non-production shutdown policies active
- [ ] Cost-per-active-patient dashboard live

## Launch decision

Go/no-go review with clinical, legal, security, design, and engineering owners; decision + evidence recorded in `docs/validation/launch-<date>.md`. Any regression on section A blocks launch outright.
