# MedicinePassport V2 — Planning and Delivery Docs

This folder is the V2 program's working documentation. It turns the **MedicinePassport V2 Master Product & Delivery Roadmap** (the owner-supplied PDF, referenced throughout as "the roadmap") into a plan that is grounded in the code that actually exists in this repository on 2026-09-06.

`docs/` (00–35) remains the V1 record and stays authoritative for anything V2 does not change. Where a V2 document supersedes a V1 one, it says so in its first paragraph. Nothing in `docs/` is edited by the V2 program except the living status board `docs/22`, which gains a pointer to [20-status-board.md](20-status-board.md).

## How to read this set

| # | Document | Read it when you need… |
|---|---|---|
| 00 | [V2 charter](00-v2-charter.md) | the vision, the ten objectives, boundaries, what is explicitly not V2 |
| 01 | [Current-state baseline](01-current-state-baseline.md) | what V1 really has, measured on 2026-09-06 (apps, packages, schema, endpoints, tests, infra, verification results) |
| 02 | [Gap analysis](02-gap-analysis.md) | roadmap capability × current state → gap → owning phase |
| 03 | [Target architecture](03-target-architecture.md) | service boundaries, event model, provenance, identity, consent, FHIR layer, ABDM adapters |
| 04 | [Canonical clinical model](04-canonical-clinical-model.md) | the Prisma-level V2 schema: new tables, extended tables, migrations, backfills, sunset |
| 05 | [API contracts V2](05-api-contracts-v2.md) | every new or changed endpoint, grouped by module, with auth and scope |
| 06 | [Phase plan](06-phase-plan.md) | Phases 0–17 as executable work packages with entry/exit gates |
| 07 | [Workstreams](07-workstreams.md) | WS01–WS18 responsibilities mapped to repo areas |
| 08 | [ABDM and FHIR integration](08-abdm-fhir-integration.md) | M8A–M8E, versioned FHIR layer, artifact mapping, sandbox exit |
| 09 | [Document intelligence](09-document-intelligence.md) | the ingestion pipeline, classifiers, extraction targets, AI traceability |
| 10 | [Clinical safety and AI governance](10-clinical-safety-and-ai-governance.md) | classification of features, safety board, explainability, hazard log additions |
| 11 | [Security, privacy, compliance](11-security-privacy-compliance.md) | DPDP, data separation, step-up auth, audit, hosting validation |
| 12 | [Deployment and environments](12-deployment-and-environments.md) | Railway/Cloudflare topology for V2, release gates, migration procedure, rollback |
| 13 | [Verification and quality](13-verification-and-quality.md) | test suites, CI gates, definition of done, conformance tests, DR drills |
| 14 | [Observability and operations](14-observability-and-operations.md) | metrics, alerting, admin platform, runbooks |
| 15 | [Release strategy](15-release-strategy.md) | V2.0 → V2.9 with feature flags and what ships in each |
| 16 | [Dependencies and risks](16-dependencies-and-risks.md) | D1–D10 and the risk register |
| 17 | [Pilot plan](17-pilot-plan.md) | pilot composition, protocol, success criteria |
| 18 | [Team and governance](18-team-and-governance.md) | roles, the four boards, decision flow |
| 19 | [Phase 0 execution checklist](19-phase-0-execution-checklist.md) | the concrete tickets for the next four weeks |
| 20 | [Status board](20-status-board.md) | the living record — update it with every meaningful change |
| 21 | [Manual UI test guide](21-manual-ui-test-guide.md) | what was built, how to set up, test cases per feature, and what is missing |
| 22 | [Handover of the leftovers](22-handover-leftovers.md) | everything that needs a person, a credential, a contract or a review, with the exact steps |
| adr | [ADR register](adr/README.md) | V2 architecture decisions (ADR-V2-001 …) |

## Status vocabulary

Same as V1 (`docs/22`), so the two boards can be read together:
**Completed · In progress · Blocked · Mocked · Requires clinical validation · Requires security review · Requires platform configuration · Deferred.**
V2 adds one: **Requires ABDM sandbox** for items that cannot be completed until NHA sandbox access exists.

## Ground rules carried over from V1 (unchanged)

- Clinical rules run only on the server; the PWA and native apps render findings, never compute them.
- Every warning carries the four-statement contract from `docs/02`.
- No PHI in URLs, logs, analytics, object keys, or notifications.
- Dev/staging never hold real patient data.
- Backups are invalid until restore-tested.
- Nothing is called "production-ready" without clinical, privacy, security, accessibility, backup and operational validation.

## Verification commands (the ones this plan was checked with)

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck
# Postgres from docker compose, CI-equivalent env:
export DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass \
  OTP_HASH_PEPPER=ci-otp-pepper-not-secret SESSION_TOKEN_PEPPER=ci-session-pepper-not-secret \
  ADMIN_PASSWORD_PEPPER=ci-admin-pepper-not-secret FIELD_ENCRYPTION_KEY='ci-field-key-not-secret-32bytes!' \
  OTP_TRANSPORT=log OTP_DEV_FIXED_CODE=000000
pnpm test
pnpm --filter @medpass/patient-web test:e2e
```

Results of the 2026-09-06 run are recorded in [01-current-state-baseline.md](01-current-state-baseline.md) §7.
