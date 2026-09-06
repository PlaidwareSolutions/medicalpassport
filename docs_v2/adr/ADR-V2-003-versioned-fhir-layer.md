# ADR-V2-003 — Versioned FHIR compatibility layer

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, WS09

## Context
NRCeS lists v6.5.0 as the current published ABDM FHIR IG and a v7.0.0 active preview (July 2026) adds the Indian Patient Summary and vital-sign profiles. The production version must follow what sandbox/production certification requires at the time. Hard-coding one version would mean rework at certification.

## Decision
`packages/fhir/ig/<version>/` holds serializer, validator bindings and fixtures per IG version. A `version-mapper` selects the active version from configuration and can emit multiple versions for diff tests. New versions are added as folders; existing folders are frozen. Pins live in `packages/fhir/IG-VERSIONS.md` with URLs and verification dates.

## Consequences
- Some duplication between version folders; accepted for isolation.
- Conformance CI runs per version folder.
- The Indian Patient Summary is a v7.x-only capability.

## Alternatives considered
Single "latest" mapping with feature flags — rejected: hard to prove conformance to a specific version. Runtime IG package loading (FHIR npm packages) — rejected: adds network/runtime dependency; may be revisited for validator profile packs.

## Verification
Conformance suite green per version; the sandbox functional test is run against the pinned version; changing the pin requires a PR touching `IG-VERSIONS.md`.
