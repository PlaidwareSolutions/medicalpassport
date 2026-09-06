# 01 — Current-State Baseline (measured 2026-09-06)

Everything below was read from the repository or produced by running its commands on 2026-09-06, branch `foundation` at `54c03f6`. Where `docs/22` claims something and the code disagrees, the code wins and the difference is noted.

## 1. Repository shape

- Turborepo + pnpm 9.15.9, Node 20 locally (CI uses Node 22), TypeScript 5.7.
- `apps/`: `api` (NestJS, single flat `AppModule`), `patient-web` (Next.js App Router PWA, Serwist SW, 41 pages), `admin-web` (17 pages), `marketing-web` (static export → Cloudflare Worker), `worker` (Postgres-backed job runner, three queues), `cron` (16 one-shot jobs), `mobile-native` (README placeholder).
- `packages/` (17): `database` (Prisma 6, 2 053-line schema, 63 models, 56 enums, 39 migrations), `domain`, `validation` (Zod), `authorization`, `audit` (hash-chained), `localization` (en/hi/te/ur, ~790 keys), `design-tokens`, `ui-web` (12 components), `api-client`, `clinical-rules` (inert scaffold; the real engine lives in `apps/api/src/modules/safety/safety-rules.ts`), `clinical-content`, `medication-terminology`, `consent`, `notifications`, `object-storage`, `offline-sync`, `observability`, `config`.
- No `packages/fhir`, no `packages/domain/fhir` module (contradicts `docs/17`), no FHIR/ABDM/ABHA/LOINC/SNOMED/RxNorm code anywhere.

## 2. Data model (what exists)

Groups: identity (4 models), profile and care (5), clinical records (10: `Practitioner`, `Prescription`, `MedicalReport`, `ReportValue`, `PatientAllergy`, `PatientCondition`, `GlucoseReading`, `BloodPressureReading`, `WeightReading`, `CheckupRecord`), catalog (9), medication and scheduling (6: `PatientMedication`, `MedicationInstruction` versioned, `MedicationChange` append-only, `MedicationSchedule`, `ScheduledDose`, `DoseEvent`), notifications (4), safety (3), sharing (3), documents/OCR (5), platform (7 incl. `BackgroundJob`, `OfflineMutation`, `AuditEvent`, `BackupExecution`, `RestoreTest`), admin/content (6), marketing (1).

Facts that shape V2:
- Field-level encryption: AES-256-GCM with a single `FIELD_ENCRYPTION_KEY`; only three encrypted columns (`User.phoneCiphertext`, `NotificationChannel.addressCiphertext`, `AdminUser.mfaSecretCiphertext`); no key-version column, so rotation needs a schema change.
- Provenance: `RecordSource` (patient/document/professional) exists on two tables only.
- `rowVersion` on three tables; `deletedAt` on clinical tables; UUID PKs; timestamptz; `recordedByUserId` on patient-entered rows.
- Timezone stored twice (`PatientProfile.timezone`, `MedicationSchedule.timezone`).
- Seed: 13 sample products stamped `SAMPLE-DEV-SEED`, never clinically reviewed.

Full inventory and gaps: [02-gap-analysis.md](02-gap-analysis.md); V2 model: [04-canonical-clinical-model.md](04-canonical-clinical-model.md).

## 3. API (what exists)

All routes under `/v1` except `healthz`/`readyz`. Global `RateLimitGuard` → `AuthGuard`; RFC 7807 problem details with `correlationId`; pino with redaction; CORS allowlist; host allowlist (421); `trust proxy`. **No helmet/CSP at origin** (Cloudflare sets HSTS).

Modules and endpoint counts (patient session unless noted): auth 8 · profiles 8 · medications 9 · prescriptions 5 · practitioners 5 · reports 7 · vitals 4 · glucose/check-ups 6 · scheduling 3 · safety 3 · caregivers 7 · claims 4 · consents 3 · documents 4 (+2 dev-storage) · extraction 5 · notifications 7 · webhooks 2 (Telnyx, Ed25519) · catalog 2 · sync 1 · leads 1 · meta 2 · health 2 · sharing 6 owner + 2 public-token · admin ≈ 30 (auth with TOTP, audit, catalog maker-checker, content, incidents/DLQ, operations, users, rules/findings).

Auth: OTP (Telnyx SMS/voice or log), scrypt-hashed codes, opaque peppered session + refresh tokens, httpOnly cookie or bearer, CSRF header, trusted-device login. Admin: password + mandatory TOTP, lockout. **No step-up authentication.** Rate limiting is a Postgres fixed window (no Redis). Turnstile server-verified where configured.

Worker queues: `ocr_extraction` (Tesseract.js English + pdf-parse), `pdf_render` (puppeteer), `content_enrichment` (openFDA/DailyMed). Cron: 16 jobs (reminders, missed doses, cleanups, backup export/verify/restore-test, retention, operational report).

Safety engine: exact/partial ingredient duplication, therapeutic-class duplication, drug-allergy, uncertain normalization, schedule conflict, dose-differs. Interaction/food/alcohol/condition checks: declared, no data (OD-4).

Sharing: `SharePackage` frozen sections, `ShareLink` token (sha256, unpeppered), ≤30-day expiry, revoke, per-attempt access log, worker PDF, `wa.me` text. Offline sync: only `dose_event` and `patient_medication` dispatched although the contract declares six entities.

## 4. Frontends (what exists)

patient-web: auth/onboarding (welcome, login, profile, tour), home, timeline (today's doses), doctor-visit mode, medicines (list/detail/edit/add/scan/confirm-type), safety, allergies, prescriptions, reports and values, doctors, blood sugar, blood pressure, body weight, profile hub, dependants, claim invitations, caregivers, share (list/new/public), offline, sync conflicts, help. Serwist SW with API traffic NetworkOnly, IndexedDB for PHI, VAPID push, install education. Read-aloud with 264 committed guidance MP3s. Localization en/hi/te/ur with RTL for Urdu. Same-site API origin logic for `*.medicinepassport.app`.

admin-web: login (TOTP), dashboard, catalog + change requests, content + versions + translations, audit search, incidents (DLQ replay, share revoke), operations, users, rules/findings.

marketing-web: static export, 4 locales built / `en` published, lead form with Turnstile, deploy preflights (`check:locales`, `check:legal`, `check:claims`, `check:launch`, `check:soft-launch`).

## 5. Infrastructure (what exists)

- Railway: `medpass-dev` (combined dev+staging) and `medpass-prod`, both deploying from GitHub `foundation` on push with `checkSuites: false` (CI does not gate deploys). Services: postgres, api (pre-deploy `prisma migrate deploy`), worker, patient-web, admin-web, 16 cron services. Region declared Singapore; **production Postgres is actually in `sfo`**. No Redis. One replica per service.
- Cloudflare: `medidocs.app` zone with Full (strict) TLS, HSTS, Free-plan single rate-limit rule (OTP 2 req/10 s/IP), cache rules; `medicinepassport.app` zone has **no** rate-limit or no-cache rules; `www` records missing on both apexes; phase-3 301 not started. R2: 11 buckets; dev and prod share one R2 credential. Turnstile live. Web Analytics on marketing only.
- Backups: nightly encrypted `pg_dump` to R2, nightly verify, monthly restore-test with row-count match — live-verified. Not done: key custody outside Railway, R2 versioning, Railway PITR verification, region-loss game day.
- Observability: pino logs in Railway's viewer, daily operational-report cron. No metrics backend, no alerting, no on-call (OD-13).
- CI (`ci.yml`): gitleaks → install → prisma generate + `migrate diff --exit-code` → build → typecheck → seed → `pnpm test` → Playwright a11y suite. **`pnpm lint` is never run and no ESLint config exists.** `deploy-staging` job is an echo stub. Marketing staging deploy skips because `CLOUDFLARE_API_TOKEN` is unprovisioned.

## 6. Documentation and governance state

- `docs/22` status board: Stage 0 Completed; Stages 1–8 and 11 In progress; 9/10 Deferred. Every remaining item is gated on non-engineering decisions (OD-2 DPDP, OD-3 catalog, OD-4 interactions, OD-6 clinical lead, OD-9 DPO, OD-11 OCR, OD-12 AI, OD-13 observability, OD-17 support channel) or platform configuration (Telnyx DLT, DNS cutover, R2 credentials).
- `docs/29` production readiness: 0 of 46 boxes checked; six partial. Pen test not done. Clinical Gates 1–6 not passed.
- Hazard log: 28 entries, all open for sign-off.
- Security review for sharing: passed 2026-08-12.
- Incident INC-2026-001 (audit chain breaks, P3) resolved; advisory lock fix in place; acknowledged boundary at seq 683 on prod.
- Brand: "Medicine Passport by MediDocs"; marketing apex `medicinepassport.app`; app on `app.medicinepassport.app`; api/admin/assets on `medidocs.app` plus `api.medicinepassport.app`. Final indexed launch not authorized (legal entity, counsel, mailboxes, erasure operator open).

## 7. Verification run — 2026-09-06 (Windows 11, Node 20.19, Docker Postgres 16 / Redis 7 / MinIO)

| Step | Command | Result |
|---|---|---|
| Migrations | `prisma migrate status` | 39 migrations, database up to date |
| Build + typecheck | `pnpm typecheck` (builds first) | 47/47 tasks OK, 0 TS errors |
| Lint | `pnpm lint` | **0 tasks** — no package defines `lint`; no ESLint config in repo |
| Package unit tests | `turbo run test --filter='!@medpass/api'` | 24/24 tasks OK (vitest: cron, patient-web, authorization, clinical-content, domain, medication-terminology, notifications, offline-sync, validation) |
| API tests, first run | `jest --runInBand` (CI env) | 42 suites: 40 passed, 2 failed; 350 tests: 321 passed, **29 failed** — all in `sharing` and `documents-extraction`, all from one cause: `test/helpers/worker.ts` spawns `pnpm` without a shell (cannot resolve `pnpm.cmd` on Windows). Also `apps/api` `test` script used POSIX inline env (`NODE_OPTIONS=… jest`), which Windows `cmd` rejects |
| Fix 1 | `apps/api/package.json` test script → `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand` | portable |
| Fix 2 | `apps/api/test/helpers/worker.ts` → `pnpm.cmd` + `shell: true` on win32 | `documents-extraction` 10/10 pass; `sharing` 17/19 pass, 2 PDF exports 500 with worker log "pdf render job failed: Connection closed." |
| Fix 3 | `apps/worker/src/processors/pdf-render.ts` → `--single-process`/`--no-zygote` only off-Windows (they crash Chrome on Windows; production container unchanged) | `sharing` **19/19 pass** |
| API tests, final | | **42/42 suites, 350/350 tests pass** |
| Playwright a11y/e2e | `pnpm --filter @medpass/patient-web test:e2e` | see §7.1 |

None of the three fixes changes production behaviour: fix 1 is the same jest invocation, fix 2 only branches on `win32`, fix 3 keeps the Linux flags. CI (Linux) is unaffected.

### 7.1 Playwright result

329 tests: **324 passed, 5 failed**. Important caveat: the Playwright config sets `reuseExistingServer` outside CI, and this laptop already had a `next dev` server on :3000 and a dev API on :4000 (both started 2026-09-04 by the developer), so the suite ran against the **dev server**, not the production build CI uses. The five failures, classified:

| Failure | Classification | Action |
|---|---|---|
| `reflow [te]` on 2 routes overflows by 7 px | environment — Windows has only Nirmala UI for Telugu; CI installs Noto fonts | none; recorded |
| `timezone` banner "12:39 am" vs "12:39 AM" | test brittleness — Node's default locale (en-IN here) vs Chromium's (en-US) | fixed: case-insensitive match; passes |
| `education` first-run tour heading | timing under 4 local workers | passes with CI's 2 workers |
| `instant-nav` strict-mode violation on the medicine name | test brittleness — the name also renders on Home during a client-side transition; one assertion was already scoped, three were not | fixed: all assertions scoped to the medicines tile; 3/4 pass |
| `instant-nav` "warm data offline" `ChunkLoadError` | environment — dev-mode webpack chunks are loaded lazily per route and cannot load offline; the production build (CI) prefetches them | none; must be run against `next start` |

The authoritative accessibility/e2e result remains the Linux CI job against the production build. To reproduce it locally, stop any dev servers on :3000/:4000 first so Playwright boots `apps/api/dist/main.js` and `next start` itself.

## 8. Things `docs/22` says that the code does not confirm

| Claim | Reality |
|---|---|
| ADR-3 "BullMQ on Redis" | Postgres `background_jobs` with `SKIP LOCKED`; no Redis anywhere |
| ADR-4 "dedicated `migrator` role" | migrations run as `preDeployCommand` with the app `DATABASE_URL` |
| `docs/17` "mapping module `packages/domain/fhir`" | does not exist |
| `docs/28` "versioned `FIELD_ENCRYPTION_KEYS` keyring" | single key, no version column |
| `docs/25` "Redis, 3 projects, 2+ replicas" | no Redis, 2 projects, 1 replica |
| `infra/railway/README.md`, `infra/cloudflare/README.md` | stale pre-bring-up plans with `example.com` placeholders |
| ABDM strategy "sandbox onboarding evaluated" | no sandbox application on record |

These are corrected by ADR-V2-006/010 and by the Phase 0 doc hygiene ticket ([19](19-phase-0-execution-checklist.md)).
