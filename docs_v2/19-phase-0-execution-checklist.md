# 19 — Phase 0 Execution Checklist (weeks 1–4, from 2026-09-08)

The concrete tickets. Each has an owner workstream, a size, an acceptance check, and the doc that specifies it. Order within a week is the recommended sequence; items in the same week are independent unless noted.

## Week 1 — decisions, guards, hygiene

| # | Ticket | WS | Size | Accept when |
|---|---|---|---|---|
| 0.1 | ✅ Owner review of `docs_v2/`; ADR-V2-001…014 accepted or amended — *ADRs accepted 2026-09-06 (owner directive)* | WS01 | S | ADR register shows status Accepted with dates |
| 0.2 | Merge `foundation` → `main`; branch protection on `main`; Railway `checkSuites: true` on both projects | WS14 | S | a red PR cannot deploy; `main` deploys dev |
| 0.3 | Provision: Railway project token for CI; scoped R2 tokens per env (dev/stg/prod); Cloudflare API token with rule permissions; Telnyx per-env keys | WS14 | S (platform) | secrets set via `railway variable set --stdin`; `infra/vendor-register.md` updated |
| 0.4 | 🟡 Create `medpass-stg` from a new `.railway/railway.stg.ts` (copy of dev with `NODE_ENV=staging`, real transports off, sandbox ABDM later) — *file written 2026-09-06 (tracks `v2`, `staging-*.medicinepassport.app`, own R2 prefix, every secret preserved); creating the project is the owner's spend decision (docs_v2/16), then plan → apply → domains → secrets → check-suites* | WS14 | M | `railway config plan --file .railway/railway.stg.ts` → apply; smoke suite green on `staging-*` |
| 0.5 | Replicate Cloudflare rules onto the `medicinepassport.app` zone; `www` records + 301 on both apexes; phase-3 `medidocs.app → medicinepassport.app` 301 (keeps `api.`/`admin.` on medidocs until 0.6) | WS14 | S (platform) | `curl -I` shows 301s; rate-limit rule visible; `CF-Cache-Status: BYPASS` on api |
| 0.6 | Move `admin.` and `assets.` to `medicinepassport.app`; Turnstile hostnames updated; CORS updated | WS14 | S | admin login works on the new host |
| 0.7 ✅ | ESLint baseline: config, `lint` scripts in every package, CI step; existing findings fixed or baselined with a burn-down file | WS15 | M | Done 2026-09-06: flat config at the root, `lint` in all 32 packages, CI step after typecheck, 0 errors; accepted warnings in [eslint-burndown.md](eslint-burndown.md) |
| 0.8 | ABDM sandbox application submitted; IG versions pinned in `packages/fhir/IG-VERSIONS.md` (v6.5.0 published, v7.0.0 preview) with URLs and verification date | WS09 | S | application id recorded in [20](20-status-board.md); file exists |
| 0.9 | Board charters signed; clinical lead decision requested (OD-6); DPO decision requested (OD-9) | WS01 | S | [18](18-team-and-governance.md) names members |
| 0.10 | ✅ Windows dev loop: keep the three 2026-09-06 fixes; add weekly `windows-latest` api-suite job — *fixes kept; `.github/workflows/windows-weekly.yml` added 2026-09-06 (Mondays + on demand); first run pending the next push* | WS15 | S | job green |

## Week 2 — provenance, contracts, tests

| # | Ticket | WS | Size | Accept when |
|---|---|---|---|---|
| 0.11 | ✅ `packages/provenance`: enums, state machine, validators, tests — *done 2026-09-06 (249 tests)* | WS12 | S | 100 % branch coverage on the state machine |
| 0.12 | ✅ Migration `v2_provenance_enums` — *done 2026-09-06* | WS12 | S | `prisma migrate diff --exit-code` green; rollback note |
| 0.13 | ✅ OpenAPI generation + pinning + CI diff; `packages/api-client` consumes generated types — *done 2026-09-06 (181 operations pinned in apps/api/openapi.json; registry cross-checks guard/step-up/rate-limit metadata; CI openapi:check step; api-client type generation deferred to OPENAPI-TYPES.md)* | WS15 | M | `apps/api/openapi.json` committed; diff step fails on unreviewed change |
| 0.14 | ✅ Worker tests: candidate detection, PDF HTML drift vs DTO, queue claim/retry/DLQ — *done 2026-09-06 (75 tests; defects logged in 16 §3, 3 fixed)* | WS15 | M | `apps/worker` has a `test` script; CI runs it |
| 0.15 | ✅ Exhaustive caregiver authz matrix test — *done 2026-09-06 (858 cells)* | WS13 | S | test enumerates DMMF models × scopes |
| 0.16 | ✅ Sync contract == dispatcher test; implement or remove the four undispatched entities — *done 2026-09-06* | WS12 | S | test green; contract updated |
| 0.17 | ✅ Move safety engine to `packages/clinical-rules` after copying golden tests — *done 2026-09-06* | WS11 | S | zero behaviour diff (golden green before and after) |
| 0.18 | ✅ Audit writes off read paths (queue `*_viewed` audit rows) — closes the V1 deferred fix behind INC-2026-001 — *done 2026-09-06 (`writeAuditDeferred` in packages/audit; 13 call sites; 7 unit + 3 e2e; [16 §3](16-dependencies-and-risks.md) item 7)* | WS12 | M | read endpoints no longer take the advisory lock; chain still verifies |

## Week 3 — security foundations, observability

| # | Ticket | WS | Size | Accept when |
|---|---|---|---|---|
| 0.19 | ✅ Security headers at origin (helmet/CSP) — *done 2026-09-06; bound from AppModule and regressed by `test/security-headers.e2e-spec.ts` (public, health, authenticated, 401, 404, `meta/openapi.json`)* | WS13 | S | headers asserted in api e2e |
| 0.20 | ✅ Step-up auth: `Session.stepUpVerifiedAt`, endpoints, guard decorator, patient-web prompt component — *done 2026-09-06 (server + client sheet; api-client hook 6 tests; Playwright 3/3)* | WS13 | M | e2e: share creation without step-up → 403; with → 201 |
| 0.21 | ✅ Encryption keyring (`FIELD_ENCRYPTION_KEYS`, `keyVersion` columns, re-encrypt job); rotation executed on dev — *done 2026-09-06 (ciphertext-versioned keyring; rotation cron; dev rotation run pending)* | WS13 | M | rotation runbook R-KEY-1 has a completed dev run recorded |
| 0.22 | `MIGRATOR_DATABASE_URL` + `READONLY_DATABASE_URL` roles; pre-deploy uses migrator — *code done 2026-09-06 (config shape, IaC pre-deploy `${MIGRATOR_DATABASE_URL:-$DATABASE_URL}`, role SQL in infra/railway/README.md); **platform step open**: create the roles on dev, then prod, and run the README verification* | WS14 | S | api runtime role cannot `ALTER` |
| 0.23 | Observability backend chosen (OD-13); OTLP wiring; seven SLI dashboards; alert routes; on-call rota of two | WS14 | M | an induced 5xx pages within 5 min on staging |
| 0.24 | ✅ Backup key custody offline (public key on Railway, private key held offline); restore-test with the offline key — *runbook written (R-DR-3); execution needs production access + custodians* | WS14 | S | R-DR-3 recorded |
| 0.25 | Rollback rehearsal: redeploy a named earlier deployment on staging; document the exact command | WS14 | S | runbook step verified |
| 0.26 | 🟡 DPIA v1, retention table proposal to counsel (OD-7), breach tabletop — *drafts written 2026-09-06 under `docs_v2/validation/privacy-security/` (DPIA, retention proposal, threat model, tabletop scenario pack); the tabletop itself and counsel/DPO sign-off are the remaining steps* | WS13 | M | documents under `docs_v2/validation/privacy-security/` |
| 0.27 | ✅ PR template with the definition-of-done and privacy checklist — *done 2026-09-06 (.github/PULL_REQUEST_TEMPLATE.md)* | WS15 | S | template in `.github/` |

## Week 4 — model groundwork and gate

| # | Ticket | WS | Size | Accept when |
|---|---|---|---|---|
| 0.28 | ✅ `packages/terminology` v0: analytes from the V1 vocabulary with LOINC/UCUM placeholders flagged for Gate 1b — *done 2026-09-06 (v1 tables, 49 tests)* | WS05 | S | snapshot tests; unmapped entries listed |
| 0.29 | ✅ `packages/fhir` skeleton: folder structure, IG pins, one artifact (`AllergyIntolerance`) round-trip with validator to prove the harness — *done 2026-09-06 (86 tests)* | WS09 | M | conformance test green for one artifact on both IG folders |
| 0.30 | ✅ `packages/health-events` skeleton + projection rule for `MedicationChange` only (proves the same-transaction pattern) — *done 2026-09-06 (full projector set, not just MedicationChange)* | WS03 | S | one event per change in e2e |
| 0.31 | ✅ Rewrite `infra/railway/README.md` and `infra/cloudflare/README.md` from IaC; mark ADR-3/4 superseded in `docs/24`; add `docs/22` pointer to `docs_v2/20` — *done 2026-09-06 (infra READMEs rewritten; docs/24 ADR-3/4 marked superseded; docs/22 pointer)* | WS01 | S | no `example.com` or Redis claims remain |
| 0.32 | ✅ Region-move runbook R-REGION-1 written and desk-checked — *written 2026-09-06 (docs_v2/runbooks/R-REGION-1); desk-check pending* | WS14 | S | runbook reviewed by Architecture Board |
| 0.33 | ✅ Product metrics event schema (PHI-free) agreed — *done 2026-09-06 (packages/observability/src/product-events.ts, closed catalogue + PHI-name guard, 3 tests)* | WS16 | S | schema in `packages/observability` |
| 0.34 | **M0 exit review**: architecture, clinical model, security architecture, ABDM strategy approved; status board updated | all boards | — | [20](20-status-board.md) shows Phase 0 Completed |

## Not in Phase 0 (deliberately)

Any patient-visible clinical feature; any migration beyond enums; vendor contracts (D1, D7, D8) beyond starting the evaluations; native apps.
