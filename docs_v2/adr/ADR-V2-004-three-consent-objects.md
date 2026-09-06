# ADR-V2-004 — Three separate consent objects

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, Privacy & Security Board

## Context
Roadmap §16: "ABDM consent and MedicinePassport sharing consent must remain separately modeled. Do not silently equate them." V1 has `Consent` (DPDP processing purposes) and `ShareLink` (disclosure). ABDM introduces HIE-CM consent artefacts with their own lifecycle (request, grant, deny, revoke, expiry, data-erase).

## Decision
Three objects with distinct tables, lifecycles, screens and copy: `Consent` (+ `ConsentNotice` versions), `ShareLink`/`SharePackage`, and `AbdmConsentArtefact` (written only by `abdm-gateway`). Revocation of one never implies another. The "Sharing & consent" screen lists all three under separate headings.

## Consequences
- No shared "consent" abstraction in code beyond a read-only summary DTO.
- Legal review can address each object separately (DPDP vs ABDM policy).

## Alternatives considered
Unified consent table with `kind` — rejected: lifecycles differ, and UI/legal semantics would blur.

## Verification
Schema review; e2e: revoking a share leaves ABDM artefacts untouched and vice versa; copy review at Gate 4.
