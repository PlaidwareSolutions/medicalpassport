# ADR-V2-010 — Hosting validated against ABDM/DPDP before production ABDM; region move allowed

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, Privacy & Security Board · Supersedes: ADR-4 (migrator role now implemented as `MIGRATOR_DATABASE_URL`)

## Context
Roadmap §28: validate the hosting architecture against ABDM security/certification requirements before V2 production and do not make the existing hosting provider a permanent constraint. Today: Railway compute in Singapore, production Postgres in `sfo`, Cloudflare edge, R2 storage. DPDP counsel review (OD-2) is open.

## Decision
Keep Railway + Cloudflare for V2.0–V2.7. Before M8E, run a documented validation of the hosting architecture against the NHA checklist and counsel's residency position. Parameterize region in IaC (already possible) and rehearse a region move (runbook R-REGION-1) in Phase 0 so that moving compute and data to an India region, or to another provider, is an operation with a measured duration rather than a redesign. Migrations run under a least-privilege migrator role; runtime uses an app role; admin reads use a read-only role.

## Consequences
- A possible region move late in the program is budgeted (time and cost) rather than discovered.
- Provider-specific features are avoided (no Cloudflare compute for app logic — ADR-11 stands).

## Alternatives considered
Move to an India region now — rejected: no requirement established yet; cost and disruption without evidence. Ignore until certification — rejected: roadmap explicitly warns against it.

## Verification
R-REGION-1 desk-checked in P0 and executed on staging before M8E; validation memo filed under `docs_v2/validation/abdm/`.
