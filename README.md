# Medicine Passport

A patient-held **medication passport, medication education assistant, and
medication-safety companion** for patients in India. Mobile-first Progressive
Web App (no app-store install required), NestJS API, PostgreSQL + Redis on
**Railway**, **Cloudflare** as the public edge and private R2 object storage.

> This product identifies *possible* medication concerns and always directs
> patients to a doctor or pharmacist. It is not a diagnostic, prescribing, or
> clinical decision system. See `docs/02-product-principles-and-boundaries.md`.

## Documentation

All planning documents live in [docs/](docs/) — product vision (00) through
clinical validation plan (34). Start with:

- [00-product-vision](docs/00-product-vision.md) · [04-mvp-and-roadmap](docs/04-mvp-and-roadmap.md)
- [12-system-architecture](docs/12-system-architecture.md) · [13-data-model](docs/13-data-model.md) · [14-api-contracts](docs/14-api-contracts.md)
- [22-implementation-plan](docs/22-implementation-plan.md) — living status board
- [24-open-decisions-and-assumptions](docs/24-open-decisions-and-assumptions.md) — ADRs + open decisions

## Repository layout

```
apps/      patient-web (Next.js PWA) · admin-web · api (NestJS) · worker (BullMQ) · cron · mobile-native (placeholder)
packages/  database (Prisma) · domain · validation · authorization · audit · localization (en/hi/te/ur) ·
           design-tokens · ui-web · api-client · clinical-rules · medication-terminology · consent ·
           notifications · object-storage · offline-sync · observability · config
infra/     railway/ · cloudflare/
docs/      35 planning documents
```

## Local development

Prereqs: Node ≥ 20, pnpm 9, PostgreSQL 16 (or Docker).

```bash
pnpm install
docker compose up -d            # PostgreSQL + Redis + MinIO (or use a local PG)

cp apps/api/.env.example apps/api/.env
cp apps/patient-web/.env.example apps/patient-web/.env

pnpm db:generate                # Prisma client
DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass pnpm db:migrate
DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass pnpm db:seed   # sample catalog (dev only)

pnpm --filter @medpass/api build && pnpm --filter @medpass/api start   # :4000
pnpm --filter @medpass/patient-web dev                                  # :3000
```

Sign in with any `+91…` number — dev OTP transport is a log fake; the code is
`OTP_DEV_FIXED_CODE` (default `000000`). The API **refuses** the log transport
in production.

## Tests

```bash
pnpm test          # unit + integration + API e2e (needs DATABASE_URL)
pnpm typecheck
pnpm build
```

## Status

Stages 0–2 delivered (docs, monorepo/infra foundation, identity + medication
passport). Stages 3–11 (documents/OCR, reminders, offline sync, safety engine,
sharing, AI, native apps, hardening) are specified in the docs and tracked in
[docs/22-implementation-plan.md](docs/22-implementation-plan.md). The seeded
medication catalog is **sample data, not clinically reviewed**.
