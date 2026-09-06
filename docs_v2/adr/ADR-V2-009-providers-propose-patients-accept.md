# ADR-V2-009 — Providers propose, patients accept

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Clinical Safety Board, Architecture Board, Privacy & Security Board

## Context
MedicinePassport is patient-controlled (roadmap §1) and V1's boundary rules forbid the system from independently changing a patient's medicines. Provider products (clinic, pharmacy, lab, hospital) must be able to contribute without becoming an EMR that overrides the patient's record.

## Decision
Provider actions create proposals (`MedicationReconciliation` lines, captured prescriptions, dispense records, encounter records, lab reports, discharge transition lines). The patient (or a caregiver with the matching scope) accepts or rejects each proposal; only acceptance writes to authoritative clinical tables, stamping provenance (`clinic_entered`/`pharmacy_entered`/`lab_imported`, `provider_verified` or `source_authenticated`). Provider reads are limited to sections granted via `ProviderPatientLink` and are audited with the organization id.

## Consequences
- A "Proposals" inbox in the patient app; provider portals show proposal status.
- Lab results the lab itself authenticates still pass through acceptance (they land pre-verified, but the patient chooses to include them).

## Alternatives considered
Direct provider writes with audit — rejected: violates patient control and V1 boundaries; makes reconciliation errors (H-43) irreversible without patient awareness.

## Verification
Tests assert provider endpoints cannot write clinical tables; e2e covers propose → accept → `MedicationChange`/`HealthEvent`; Gate 8.
