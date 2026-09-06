# ADR-V2-014 — ESLint gate in CI

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Architecture Board, WS15

## Context
The repository has no ESLint configuration; `pnpm lint` executes zero tasks, and CI never runs it. `docs/22` lists `eslint-plugin-jsx-a11y` in CI as a "not built" follow-up. V2 introduces safety-copy rules (imperative-verb deny-list), package boundary rules (`packages/fhir` must not import Prisma; no clinical computation in web apps) that are cheapest to enforce as lint rules.

## Decision
Flat ESLint config at the root with `typescript-eslint` (type-aware on `apps/api`, `packages/*`), `eslint-plugin-jsx-a11y` for the Next apps, `eslint-plugin-import` boundaries, and custom rules for: safety-copy verbs in `packages/localization`, forbidden Prisma imports in `packages/fhir`/`terminology`/`document-intelligence`, and forbidden `interpretation` computation in `apps/patient-web`. Every package gets a `lint` script; CI runs `pnpm lint` before build. Existing findings are fixed or listed in a burn-down file with an owner and a date.

## Consequences
- Initial cleanup cost (unknown count until the baseline run).
- Architectural rules become executable.

## Alternatives considered
Biome — considered for speed; rejected for now because the custom rules and jsx-a11y coverage matter more than speed.

## Verification
`pnpm lint` runs N > 0 tasks in CI and blocks merges; the burn-down file trends to zero by V2.0.
