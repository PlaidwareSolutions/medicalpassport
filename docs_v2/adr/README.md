# V2 Architecture Decision Records

Continues `docs/24` (ADR-1 … ADR-14). V2 records use the prefix `ADR-V2-`. Status: Proposed → Accepted → Superseded. Accepted records are immutable; changes are new records.

| ADR | Title | Status | Supersedes |
|---|---|---|---|
| [ADR-V2-001](ADR-V2-001-canonical-model-not-fhir-store.md) | Product-shaped canonical model; FHIR only at the boundary | Accepted 2026-09-06 | — |
| [ADR-V2-002](ADR-V2-002-mandatory-provenance.md) | Mandatory provenance block with monotonic verification state | Accepted 2026-09-06 | — |
| [ADR-V2-003](ADR-V2-003-versioned-fhir-layer.md) | Versioned FHIR compatibility layer (IG v6.5 and v7.x side by side) | Accepted 2026-09-06 | — |
| [ADR-V2-004](ADR-V2-004-three-consent-objects.md) | Three separate consent objects (DPDP consent, MP share, ABDM artefact) | Accepted 2026-09-06 | — |
| [ADR-V2-005](ADR-V2-005-abdm-gateway-service.md) | `apps/abdm-gateway` as an isolated service | Accepted 2026-09-06 | — |
| [ADR-V2-006](ADR-V2-006-postgres-queue-retained.md) | Postgres job queue retained; no Redis; revisit triggers | Accepted 2026-09-06 | ADR-3 |
| [ADR-V2-007](ADR-V2-007-additive-migrations-then-sunset.md) | Additive-only migrations until V2.4; single verified sunset migration | Accepted 2026-09-06 | — |
| [ADR-V2-008](ADR-V2-008-health-event-projection.md) | `HealthEvent` synchronous projection table for the timeline | Accepted 2026-09-06 | — |
| [ADR-V2-009](ADR-V2-009-providers-propose-patients-accept.md) | Providers propose, patients accept | Accepted 2026-09-06 | — |
| [ADR-V2-010](ADR-V2-010-hosting-validation-and-region.md) | Hosting validated against ABDM/DPDP before production ABDM; region move allowed | Accepted 2026-09-06 | ADR-4 (migrator role now implemented) |
| [ADR-V2-011](ADR-V2-011-generic-observation-table.md) | Generic `Observation` table replaces per-vital tables | Accepted 2026-09-06 | — |
| [ADR-V2-012](ADR-V2-012-step-up-authentication.md) | Step-up authentication for sensitive operations | Accepted 2026-09-06 | — |
| [ADR-V2-013](ADR-V2-013-openapi-contract.md) | OpenAPI as the API contract source of truth | Accepted 2026-09-06 | — |
| [ADR-V2-014](ADR-V2-014-eslint-gate.md) | ESLint gate in CI | Accepted 2026-09-06 | — |

Template:

```
# ADR-V2-NNN — Title
Status · Date · Deciders
## Context
## Decision
## Consequences
## Alternatives considered
## Verification (how we know it holds)
```
