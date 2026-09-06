# 13 — Verification and Quality Plan

Extends `docs/20-testing-strategy.md`. Measured starting point (2026-09-06): api 42 jest suites / 350 tests (all green after three Windows-portability fixes), 10 vitest files across 7 packages + cron + patient-web, Playwright suite (axe, 320 px/200 % reflow × 4 locales, guidance audio, education, documents upload, instant navigation, timezone), **no lint, no worker tests, no OpenAPI, no FHIR conformance, no exhaustive authz matrix**.

## 1. Suites (roadmap §34) and where each lives

| Suite | Tool | Location | Gate |
|---|---|---|---|
| Unit | vitest (packages, cron, web), jest (api `*.spec.ts`) | per package | PR |
| Contract | OpenAPI diff (`openapi.json` pinned) + generated client round-trip | `apps/api`, `packages/api-client` | PR |
| Integration (DB) | jest e2e against Postgres: migrations up + backfills against a V1-shaped fixture DB; queue claim/retry/DLQ; cron idempotency (run twice ⇒ same state) | `apps/api/test/*.e2e-spec.ts`, `apps/api/test/migrations/`, `apps/worker/test/` | PR |
| Clinical-rule | golden set (16 cases + reconciliation + multi-prescription + provider proposal cases) | `packages/clinical-rules/test/golden/` | PR; Gate 2 |
| FHIR conformance | `packages/fhir/conformance`: fixtures per artifact × IG version; validator; round-trip (canonical → FHIR → canonical) | `packages/fhir` | PR from M8C; Gate 7 |
| Security / authz | exhaustive matrix generated from scopes × entities; IDOR probes for every `:id` route (generated from OpenAPI); ZAP baseline nightly | `packages/authorization/test`, `apps/api/test/authz-matrix.e2e-spec.ts` | PR / nightly |
| Provenance | CI script asserts every clinical model has the block; test asserts no client-settable provenance; state-machine unit tests | `packages/provenance`, `packages/database/scripts` | PR |
| Health events | each clinical write emits exactly one event; backfill idempotent | `packages/health-events` | PR |
| Document intelligence | classification + extraction on the synthetic corpus (committed); consented corpus nightly (private bucket); zero unconfirmed-to-confirmed paths | `packages/document-intelligence/test`, `apps/worker/test` | PR / nightly; Gate 5–6 |
| E2E | Playwright against real api + built Next: existing specs + `timeline`, `documents-v2`, `diagnostics`, `observations`, `caregiver-scopes`, `share-snapshot`, `abdm-mock`, `provider-workflow` | `apps/patient-web/e2e`, `apps/provider-web/e2e` | PR |
| Accessibility | axe zero serious/critical; 320 px × 200 % reflow; every route × every published locale; manual TalkBack/VoiceOver pass per release | Playwright | PR / release |
| Localization | pseudo-locale, RTL (ur), no truncation, guidance-audio manifest drift, safety-copy imperative-verb lint | vitest + Playwright | PR |
| Offline / PWA | SW harness, mutation queue, conflicts, storage pressure; Background Sync fallback | Playwright | PR |
| Performance | k6/autocannon against staging: p95 < 500 ms API, timeline for a 500-event profile < 2 s, snapshot < 2 s; 5× launch traffic before V2.8 | `apps/api/perf/` | release |
| Backup / DR | monthly restore-test (exists); quarterly region-loss game day (measured RTO) | cron + runbook | scheduled |
| Infra / deploy | smoke suite after every deploy ([12 §10](12-deployment-and-environments.md)); Cloudflare `CF-Cache-Status: BYPASS/DYNAMIC` on sensitive routes | CI post-deploy | every deploy |
| Secret leak | gitleaks (exists) + log scanner for PHI patterns in sampled logs | CI / nightly | PR / nightly |
| Windows dev loop | api suite on `windows-latest` weekly | CI | weekly |

## 2. CI pipeline (P0-4/5/6 change `ci.yml`)

```
PR:      gitleaks → install → prisma generate + migrate deploy + migrate diff --exit-code
         → lint → build → typecheck → openapi:generate + diff → seed
         → test (unit + integration + api e2e + worker) → provenance-check → e2e (Playwright)
main:    PR steps → deploy dev → smoke(dev)
nightly: ZAP baseline(stg) → consented corpus → full mock-ABDM e2e → perf smoke → log PHI scan → dependency audit
tag rc:  deploy stg → migration dry-run on prod-shaped snapshot → smoke(stg) → restore-test(pre-release backup)
tag:     deploy prod → smoke(prod) → flags stay 0 % until manual widen
weekly:  windows api suite
```

Branch protection on `main`: required checks = the PR job; no direct pushes; Railway `checkSuites: true`.

## 3. Definition of done for a PR

- [ ] Lint, typecheck, tests green; new code has unit tests; new endpoints have e2e tests and appear in `openapi.json`
- [ ] Migration + backfill + parity report if schema changed; provenance columns present; `HealthEvent` emitted
- [ ] Authorization entry for every new entity/route; authz matrix regenerated
- [ ] Audit actions added to the taxonomy and asserted in tests
- [ ] Localization keys in all published locales; guidance audio regenerated if the screen speaks; safety-copy lint green
- [ ] axe/reflow green for new screens
- [ ] Hazard log reviewed (new hazard or "no new hazard" stated)
- [ ] Privacy checklist answered ([11 §10](11-security-privacy-compliance.md))
- [ ] Status board row updated

## 4. Phase exit evidence

Each phase in [06](06-phase-plan.md) names its exit gate. Evidence is committed under `docs_v2/validation/<phase>/` as: CI run links, test counts, gate reports, board sign-off notes, and for clinical gates the reviewer identities and dates.

## 5. Test data policy

Synthetic only in dev/CI. The Gate 5 consented corpus lives in a private R2 bucket with access restricted to the nightly job's credential; never copied into the repo. ABDM sandbox uses NHA-issued test identities only. Pilot data is production data and is never copied to lower environments; pilot analysis uses the PHI-free metrics pipeline.

## 6. Coverage policy

No blanket percentage. Required: every branch of the provenance state machine, every safety rule, every authorization decision, every FHIR artifact mapping, every migration/backfill pair, every proposal accept/reject path. Coverage reports are published per package for visibility; a drop > 5 % on `packages/clinical-rules`, `packages/provenance`, `packages/authorization`, `packages/fhir` fails the PR.

## 7. Quality debt paid in Phase 0 (from the baseline)

1. ESLint with `typescript-eslint`, `eslint-plugin-jsx-a11y`, import ordering; `lint` script in every package; CI step.
2. Worker tests: candidate detection unit tests; `visit-summary-html.ts` drift test against the API DTO (the file itself documents a silent-drift hazard); queue integration tests.
3. OpenAPI generation and pinning; api-client types generated.
4. Sync contract == dispatcher test.
5. Exhaustive caregiver authz matrix.
6. `packages/clinical-rules` becomes the engine's home with golden tests moved first.
7. Windows portability kept (fixed 2026-09-06: api test script, worker spawn helper, Chrome launch flags).
8. Retire stale infra READMEs; align ADR-3/ADR-4 with reality.
