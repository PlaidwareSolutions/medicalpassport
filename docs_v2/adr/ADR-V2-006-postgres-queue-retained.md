# ADR-V2-006 — Postgres job queue retained; no Redis

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board · Supersedes: ADR-3

## Context
ADR-3 chose BullMQ on Redis, but V1 shipped a Postgres queue (`background_jobs` with `FOR UPDATE SKIP LOCKED`, retries, dead-letter table, admin replay) and no Redis exists in any environment. Rate limiting is also Postgres-backed. It works and is operationally simpler.

## Decision
Keep the Postgres queue as the job system for V2, adding queues for document classification/extraction, FHIR validation, ABDM outbound/inbound, trend recomputation, backfills and notification dispatch. Do not introduce Redis or BullMQ.

Revisit triggers (any one): sustained queue lag > 60 s at p95 for a week; > 1 M jobs/day; a need for fan-out pub/sub across services; Postgres CPU attributable to queue polling > 15 %.

## Consequences
- One data store; backups cover queue state.
- Polling latency (500 ms) is acceptable for all V2 jobs; dose reminders remain cron-driven at 1-minute granularity.

## Alternatives considered
BullMQ/Redis — deferred; adds an addon, a credential, and a failure mode with no current need.

## Verification
Queue-lag SLI in [14](../14-observability-and-operations.md); revisit triggers reviewed quarterly by the Architecture Board.
