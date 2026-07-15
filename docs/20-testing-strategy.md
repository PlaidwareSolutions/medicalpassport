# 20 — Testing Strategy

Test pyramid: unit (Vitest/Jest) → contract (OpenAPI schema pinning + generated-client round-trips) → integration (Testcontainers PG/Redis) → end-to-end (Playwright against a full local stack) → device/manual passes. CI runs everything on every PR; nightly runs the extended matrix.

## Suites (spec §24)

| Suite | Tooling | Scope highlights |
|---|---|---|
| Unit | Vitest | validation schemas, authorization policies, OTP hashing/limits, frequency-pattern parsing (1-0-1/OD/BD…), normalization helpers, reminder wording privacy modes |
| Contract | OpenAPI diff + generated client | breaking-change detection; identical suite must pass for native clients (Phase 2 gate) |
| Integration | Jest + Testcontainers | API modules against real PG/Redis; migrations up/down; worker retry/backoff/DLQ; cron idempotency (run twice ⇒ same state) |
| E2E | Playwright | OTP → profile → add medication → detail; caregiver grant/use/revoke; share create/access/expire/revoke |
| PWA | Playwright (offline emulation, SW harness) | full list below |
| Mobile-browser / responsive | Playwright device profiles + manual matrix | Chrome Android, Samsung Internet, Safari iPhone, desktop Chrome/Edge, Firefox where practical; 320 px—desktop |
| Accessibility | axe-core in Playwright + manual TalkBack/VoiceOver | zero serious/critical; [33](33-accessibility-strategy.md) pack |
| Localization | pseudo-locale + snapshot + human review | en/hi/te/ur, RTL Urdu, no truncation |
| OCR | golden corpus | per-field precision/recall, confidence calibration, low-confidence gating ([34 Gate 5](34-clinical-validation-plan.md)) |
| Clinical rules | golden clinical set | all 16 §24 clinical cases ([34 Gate 2](34-clinical-validation-plan.md) table) incl. duplication, normalization, interaction, consent, caregiver-permission cases |
| Security | ZAP baseline + custom | authz matrix (every endpoint × role × scope), rate limits, enumeration-safety, upload validation, CSRF, headers |
| Audit completeness | integration assertions | every PHI mutation path emits its audit event; hash-chain verification |
| AI | hallucination / unsupported-claim / prompt-injection suites | grounding checks, prohibited classes, hostile OCR/notes strings ([19](19-ai-use-and-guardrails.md)) |
| Infra/deploy | smoke + chaos-lite | Railway deployment tests (health gates), private-network reachability tests, migration forward/rollback, Redis restart recovery, PG connection exhaustion behavior |
| R2 | integration vs R2-compatible local (MinIO) + staging R2 | presign expiry, wrong-type rejection, checksum mismatch, orphan cleanup |
| Cloudflare | staging probes | cache rules (sensitive routes never cached — assert `CF-Cache-Status: BYPASS/DYNAMIC`), WAF block behavior, rate-limit responses |
| Backup/restore | scheduled staging job | backup produced, checksummed, restored to scratch DB, row-count/integrity verified ([27](27-backup-and-disaster-recovery.md)) |
| Secret-leak | gitleaks in CI + log scanner | repo history, PR diffs, structured-log samples asserted PHI/secret-free |

## Mandatory PWA cases (spec §24)

Use without installation · add to home screen · app update available · service-worker update · offline application shell · offline medication view · offline dose recording · failed synchronization · revoked session (purge) · unsupported browser push → SMS/WhatsApp offer · denied camera permission → upload · denied notification permission · low storage · cleared browser storage · private browsing limitations · slow network (3G throttle) · lost connectivity during upload (resume/retry).

## Mandatory clinical cases (spec §24)

Same ingredient different brands · partial duplication via combination · similar therapeutic classes · intentional duplicate · missing ingredient · conflicting strength · unclear unit · multiple prescribers · allergy match · no reliable interaction data (fallback string) · low-confidence OCR · completed medication still scheduled · PRN misinterpretation · different formulations · missing patient purpose · expired course.

## Mandatory infrastructure cases (spec §24)

API unavailable (client behavior + retry) · worker restart mid-job (idempotent resume) · Redis restart (queue recovery, PG remains truth) · PG connection exhaustion (pool limits, graceful 503) · R2 unavailable (upload deferral, no data loss) · duplicate completion request (idempotent) · upload succeeds but callback fails (reconciliation cron finds it) · missing object · orphaned object cleanup · expired share link · revoked caregiver · sensitive-route caching attempt blocked · backup restore.

## Data policy

Tests use synthetic data only; **no real production patient data in development or automated testing** — enforced by environment isolation ([28](28-environment-and-secrets-strategy.md)) and seed fixtures. Merge gates: unit+contract+integration+e2e+a11y green; nightly gates: full matrix; release gates: [29](29-production-readiness-checklist.md).
