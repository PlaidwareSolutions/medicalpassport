# ADR-V2-001 — Product-shaped canonical model; FHIR only at the boundary

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board

## Context
The roadmap (§3) states the application database does not need to be a raw FHIR database. V1 already has a product-shaped Prisma schema (63 models) with strong medication semantics (versioned instructions, append-only changes, entered vs normalized values) that FHIR resources express awkwardly. ABDM profiles change (v6.5 → v7.x preview) and would force schema churn if stored natively.

## Decision
Keep a product-shaped canonical model in Postgres as the single source of truth. Introduce `packages/fhir` as a pure transformation/conformance layer and `packages/terminology` as a versioned code-mapping layer. FHIR bundles are produced on export and parsed on import into `ExtractionCandidate` rows; FHIR JSON is never the authoritative store (inbound raw bundles are kept as evidence objects in R2 only).

## Consequences
- Schema changes are driven by product needs; IG changes are absorbed in `packages/fhir/ig/*`.
- Mapping gaps surface as `FhirValidationFailure` rows instead of blocking product features.
- A FHIR server product (HAPI etc.) is not needed; conformance is proven by tests, not by a server.

## Alternatives considered
FHIR-native store (JSONB resources) — rejected: loses V1 semantics, couples the schema to IG versions, complicates row-level scoping and provenance. Dual-write to a FHIR server — rejected: two sources of truth.

## Verification
`packages/fhir` has no Prisma dependency (lint rule); round-trip tests canonical → FHIR → canonical for every supported artifact; no table stores FHIR as source (schema review at each migration).
