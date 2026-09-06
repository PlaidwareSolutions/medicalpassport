# ADR-V2-002 — Mandatory provenance block with monotonic verification state

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, Clinical Safety Board

## Context
Roadmap §9 "Critical decision": every clinical record must contain provenance (source: user/caregiver/OCR/clinic/lab/device/ABDM; verification: unverified/patient-confirmed/provider-verified/source-authenticated), and patient-entered or OCR-generated data must never be represented as provider-authenticated. V1 has `RecordSource` on two tables only and no verification state.

## Decision
Every patient-clinical table carries the provenance block defined in [04 §1](../04-canonical-clinical-model.md): `source`, `verification`, `recordedByUserId`, `recordedVia`, and nullable links to the source document/extraction/device/ABDM transaction/organization/practitioner. `verification` is monotonic (only moves up) and each transition is restricted to entitled actors. Clients can never set provenance; services stamp it. Backfill assigns V1 rows conservatively (`user_entered`/`ocr_extracted`, `patient_confirmed` only where a V1 confirmation timestamp exists).

## Consequences
- Adds ~10 columns to ~15 tables; additive migration then NOT NULL after backfill.
- UI trust badges and FHIR `Provenance` derive from the same fields.
- Extraction/import code cannot write clinical tables directly (single materialization path).

## Alternatives considered
A separate `provenance` table joined per row — rejected: every read needs the join and NOT NULL cannot be enforced. Free-text `source` — rejected: not testable.

## Verification
CI script `check-provenance.ts` fails if a listed model lacks a column; state-machine unit tests cover every transition; a validation test asserts DTOs strip client-sent provenance; the FHIR serializer refuses rows without provenance.
