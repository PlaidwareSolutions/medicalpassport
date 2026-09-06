# ADR-V2-011 — Generic `Observation` table replaces per-vital tables

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, Clinical Safety Board

## Context
V1 has `GlucoseReading`, `BloodPressureReading` (with pulse), `WeightReading` and `CheckupRecord` with embedded metrics, explicitly never synced with each other. The roadmap adds SpO2, temperature, heart rate, respiratory rate, INR, peak flow, body composition, pain, insulin dose and fluid balance. A table per concept would be 15+ lookalike tables.

## Decision
One `Observation` table keyed by `ObservationConcept`, with `valueNumeric`/`valueNumeric2` (BP), canonical `unit` enforced per concept by `packages/domain`, `enteredValueText`/`enteredUnit` preserved, context, body site, method, `measuredAt` + local time, `interpretation` set only by labs/providers/approved rules, device provenance, and the provenance block. V1 tables are backfilled and served read-only until the sunset migration (ADR-V2-007).

## Consequences
- Per-concept validation lives in code (unit tables, plausibility ranges), not in table shape.
- One trend service for all concepts.
- Check constraints per concept are expressed as a `CHECK` on `(concept, value ranges)` generated from the domain table.

## Alternatives considered
Keep per-vital tables and add six more — rejected: duplication, no shared trend logic, no device provenance. EAV with string values — rejected: loses numeric typing and unit enforcement.

## Verification
Backfill parity report; unit-enforcement unit tests per concept; trend tests per concept; V1 endpoints served from `Observation` pass the existing `vitals`/`blood-sugar` e2e suites unchanged.
