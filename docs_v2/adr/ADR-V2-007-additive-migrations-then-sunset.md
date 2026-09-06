# ADR-V2-007 — Additive-only migrations until V2.4; single verified sunset migration

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, WS12

## Context
V2 replaces several V1 tables (`PrescriptionDocument`, `PrescriptionExtraction`, `MedicalReport`, `ReportValue`, three readings tables, `CheckupRecord`). Production has real pilot data. Migrations run as a pre-deploy step on the api service; rollback of destructive migrations is not rehearsable.

## Decision
All V2 migrations through V2.4 are additive (new tables/columns, nullable first, NOT NULL after backfill). V1 tables are backfilled into V2 shapes by idempotent jobs, served read-only behind flags, and dropped by one sunset migration at V2.5 that runs only after: a release with zero V1 writes (audit-verified), a `MigrationParityReport` with matching counts, and a passed restore-test on the pre-sunset backup. Migrations use `MIGRATOR_DATABASE_URL`.

## Consequences
- Temporary duplication of data and read paths (façade endpoints).
- One irreversible event, heavily gated (runbook R-MIG-2).

## Alternatives considered
In-place renames/transforms per release — rejected: irreversible steps spread across releases.

## Verification
`apps/api/test/migrations/*.e2e-spec.ts` run migrate + backfill on a V1-shaped fixture; parity report rows; sunset migration guarded by a preflight script that checks the three conditions.
