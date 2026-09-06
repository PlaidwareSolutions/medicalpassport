# ADR-V2-013 — OpenAPI as the API contract source of truth

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, WS15

## Context
`docs/14` describes contracts in prose; `packages/api-client` is hand-written; `docs/20` calls for contract tests with "OpenAPI schema pinning" but no spec exists. V2 adds ~120 endpoints and two more clients (provider-web, native), and native compatibility is a stated Phase 2 gate.

## Decision
Generate OpenAPI 3.1 from Nest decorators plus the Zod DTOs in `packages/validation` at build time; commit `apps/api/openapi.json`; CI fails on an unreviewed diff; generate client types for `packages/api-client` from the spec; serve the spec at `GET meta/openapi.json`. Breaking changes require a `/v2` route and a deprecation row in [05 §15](../05-api-contracts-v2.md).

## Consequences
- Every endpoint needs decorators/DTOs (already the pattern); undocumented endpoints fail the build.
- IDOR probe tests can be generated from the spec's `:id` routes.

## Alternatives considered
tRPC — rejected: NestJS + multiple client platforms; REST/OpenAPI matches ABDM/FHIR tooling. Hand-maintained spec — rejected: drifts.

## Verification
CI diff step; generated client compiles; contract test replays every documented example against the running API.
