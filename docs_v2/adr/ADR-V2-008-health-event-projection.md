# ADR-V2-008 — `HealthEvent` synchronous projection table

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, WS03

## Context
The unified timeline (roadmap §10) needs every clinical fact in chronological order. V1 history is scattered across `MedicationChange`, `DoseEvent`, `ConsentEvent`, `AuditEvent`, `SafetyFindingAction` and the clinical tables themselves. Querying a union of 15 tables per page load does not scale and cannot be indexed consistently.

## Decision
A denormalized, append-only `HealthEvent` table written in the same transaction as the source row through `packages/health-events` (same pattern as `packages/audit`). Dose-level events are not projected by default (volume); weekly adherence summaries are projected as `system_derived`. Corrections/deletes set `supersededAt` on the prior event and append a new one.

## Consequences
- Every clinical write service gains one call; missing calls are caught by tests that assert one event per write.
- Backfill job for V1 data; idempotent by `(entityType, entityId, kind)`.
- The timeline reads one indexed table.

## Alternatives considered
Query-time union view — rejected: performance, ordering rules per table. Async projection via queue — rejected: read-after-write inconsistency on the timeline right after saving.

## Verification
e2e: a synthetic 24-month profile reconstructs in order; per-service tests assert event emission; backfill parity counts.
