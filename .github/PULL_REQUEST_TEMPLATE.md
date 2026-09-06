<!-- docs_v2/13 §3 definition of done · docs_v2/11 §10 privacy checklist -->

## What and why

<!-- one paragraph; link the docs_v2 work package (e.g. P1-3) and any ADR -->

## Definition of done

- [ ] Lint, typecheck and tests green; new code has unit tests; new endpoints have e2e tests and appear in `apps/api/openapi.json`
- [ ] Migration + backfill + parity note if the schema changed; provenance columns present (`node packages/database/scripts/check-provenance.mjs`); `HealthEvent` emitted where a clinical fact changed
- [ ] Authorization entry for every new entity/route; `pnpm --filter @medpass/authorization test` green (matrix snapshot reviewed if it changed)
- [ ] Audit actions added to `packages/domain/src/audit-actions.ts` and asserted in tests
- [ ] Localization keys in every published locale; guidance audio regenerated if the screen speaks; safety-copy lint green
- [ ] axe/reflow green for new screens (`pnpm --filter @medpass/patient-web test:e2e`)
- [ ] Hazard log reviewed: new hazard added to `docs_v2/10 §5`, or "no new hazard" stated below
- [ ] `docs_v2/20-status-board.md` row updated

## Privacy by design (answer each; "none" is a valid answer)

- New personal data introduced:
- Purpose / consent it relies on:
- Retention class (`docs_v2/11 §6`):
- Access path (who can read it, via which scope/link):
- Audit events emitted:
- Does any of it reach a vendor? Which, under which DPA?
- Could any of it appear in a URL, log line, metric or notification?

## Hazard review

<!-- H-xx added / reviewed, or "no new hazard: <reason>" -->

## Rollback

<!-- additive migration → leave columns unused; feature flag name; anything irreversible -->
