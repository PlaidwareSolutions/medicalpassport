# 22 — Implementation Plan

Stages per spec §25 + pasted Stages 8–11. Status categories (spec §29): **Completed · In progress · Blocked · Mocked · Requires clinical validation · Requires security review · Requires platform configuration · Deferred to Android phase · Deferred to iOS phase.** This table is the living status record — update it with every meaningful change.

## Status board

| Stage | Scope | Status |
|---|---|---|
| 0 Discovery & safety | All 35 planning docs, ADRs, hazard log, data-source/licensing investigation, residency analysis | **Completed** (docs); licensing/legal items **Blocked** on OD-2/3/4 decisions |
| 1 Repository & infrastructure | Monorepo, apps, packages, Dockerfiles, Railway config, PG, Redis, private networking, health, Cloudflare DNS plan, R2 dev integration, secrets, CI/CD, logging, audit framework, localization, design system, PWA manifest, SW foundation | **In progress** (this session). Railway/Cloudflare live setup: **Requires platform configuration** |
| 2 Identity & medication passport | OTP, sessions, profiles, caregivers, consent, catalog, manual entry, list/detail, mobile-first UX | **In progress** (this session). OTP SMS delivery: **Mocked** (log transport) → **Requires platform configuration**. Seed catalog: **Mocked / Requires clinical validation** |
| 3 Secure documents | Private R2, presigned uploads, camera capture, verification, secure downloads, audit, cleanup | Pending |
| 4 Scheduling & reminders | Schedules, timeline, browser notifications, in-app, SMS/WhatsApp fallback, snooze, missed-dose reconciliation, refill/completion, privacy wording | Pending. Providers: **Requires platform configuration** (OD-10) |
| 5 Offline PWA | Offline shell, IndexedDB caches, offline dose events, mutation queue, sync, conflicts, update notification, storage cleanup, revocation behavior | Pending |
| 6 Safety review | Normalization, duplicate checks, validated interaction integration, allergy checks, findings, explanations, traceability, review workflow | Pending. **Requires clinical validation** (Gates 1–3) + **Blocked** on OD-3/4 licensing for interactions |
| 7 Sharing | Visit summary, PDF, secure links, QR, WhatsApp summary, consent, expiry, revocation, audit, no-store | Pending. **Requires security review** before exposure |
| 8 OCR & AI assistance | OCR, candidate extraction, confidence, confirmation, approved-content simplification, translation, AI auditing, AI traceability | Pending. **Requires clinical validation** (Gates 5–6); providers **Requires platform configuration** (OD-11/12) |
| 9 Native Android | Expo app, shared packages, native notifications, encrypted storage, background sync, biometrics, camera, API compatibility, Play Store | **Deferred to Android phase** |
| 10 Native iOS | iOS support, accessibility, notifications, biometrics, encrypted storage, App Store | **Deferred to iOS phase** |
| 11 Production hardening | Backups + restore testing, WAF, rate limiting, Turnstile, security review, privacy review, accessibility, load testing, cost controls, incident runbooks, monitoring, clinical validation gates, browser compatibility, reminder delivery, offline recovery | Pending — gates the production label |

## Dependency notes

- Stage 4 depends on Stage 2 medications + schedules subset of Stage 2 schema; Stage 5 depends on 2+4; Stage 6 depends on 2 (and 3 for prescription-driven checks); Stage 7 depends on 2 (richer with 4/6); Stage 8 depends on 3.
- Cross-stage: licensing decisions (OD-3/4) long-lead — start immediately; provider selections (OD-10/11/12) needed before Stages 4/8 respectively; clinical lead appointment (OD-6) before Stage 6 content work.

## Definition of done (every stage)

Code + tests per [20](20-testing-strategy.md) · docs updated · hazard log reviewed for new risks · audit events wired · status board updated · demo against acceptance criteria · no non-negotiable rule ([02](02-product-principles-and-boundaries.md)) violated.

## This session's deliverable detail

**Stage 1:** Turborepo + pnpm; `apps/{patient-web,admin-web,api,worker,cron,mobile-native*}`; all 17 packages scaffolded; Dockerfiles; docker-compose (PG+Redis dev); API health/logging/correlation/`/v1`; PWA manifest + Serwist SW + offline fallback + bottom-nav shell; admin shell; CI (lint/typecheck/test/build/migration-check/gitleaks); `infra/railway` + `infra/cloudflare` configs as code/docs; `.env.example` per app.

**Stage 2:** Prisma schema (★ subset of [13](13-data-model.md)) + migrations + seed; API modules: auth (OTP/sessions/devices), profiles, caregivers, consents, catalog search, patient medications (idempotent writes, rowVersion, audit); PWA screens: welcome/language/OTP/create-profile/home/medicines list/add (search+manual)/detail/profile area basics.
