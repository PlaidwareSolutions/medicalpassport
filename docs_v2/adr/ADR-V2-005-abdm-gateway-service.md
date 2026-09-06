# ADR-V2-005 — `apps/abdm-gateway` as an isolated service

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, Privacy & Security Board

## Context
ABDM integration needs gateway credentials, HIU/HIP key pairs, public callback endpoints and an NHA security assessment. The consumer PHR must remain deployable and usable without ABDM (ABHA is never required), and HIP/HIU roles are certified separately from the PHR role (roadmap §4).

## Decision
A separate NestJS service, own Railway service and hostname, own secrets. It exposes only ABDM callback routes and an internal authenticated API on Railway private networking. It persists `AbdmTransaction`/`AbdmDataBundle`, stores raw encrypted payloads in an R2 `abdm-inbox` bucket, and enqueues jobs. `apps/api` never holds ABDM credentials. A `MOCK=true` mode replays recorded sandbox fixtures for local/CI.

## Consequences
- One more deployable, one more hostname; certification scope is narrower and clearer.
- Local development runs against the mock gateway.

## Alternatives considered
ABDM module inside `apps/api` — rejected: mixes public callback surface and credentials with the patient API, widens certification scope, blocks deploying the PHR without ABDM.

## Verification
`apps/api` has no ABDM secret env vars in `packages/config`; callback signature verification tests; full flow e2e against the mock gateway in CI; sandbox transactions recorded on staging.
