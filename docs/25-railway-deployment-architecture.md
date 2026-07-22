# 25 — Railway Deployment Architecture

## Environments

Three Railway environments — **development, staging, production** — as separate Railway projects (strongest isolation: separate members, tokens, variables, databases, buckets). Production access restricted to release operators; no production data ever leaves production ([28](28-environment-and-secrets-strategy.md)).

**Built and live (Stage 11 follow-up, production pilot bring-up):** `medpass-prod` is now a real, separate Railway project — its own Postgres, its own api/worker/patient-web/admin-web services, all 13 cron jobs, and its own secrets (encryption keys, OTP/session peppers, VAPID keypair, Turnstile widget all freshly generated, never shared with `medpass-dev`). Domains are live: `app.`/`api.`/`admin.medidocs.app` (Cloudflare DNS, Full-strict TLS + HSTS, WAF managed ruleset, the OTP rate-limit rule and the api/admin no-cache rule both extended to cover the production hostnames alongside staging's). `OTP_TRANSPORT=voice` is this environment's default — real Telnyx SMS delivery to India remains platform-blocked (toll-free verification + DLT registration outstanding), so the already-verified Telnyx Call Control voice OTP channel is the working login path for this pilot, per an explicit decision (voice OTP is a pragmatic choice, not a confirmed TRAI/TCCCPR-compliant bypass — see docs/22 Stage 4). Honest gaps against this doc's target architecture, for this pilot pass: 1 replica per service (not "2+ replicas prod"), no Redis (same Postgres-backed substitution as dev, see below), single region with no failover rehearsed, and the R2 access-key/secret credential is currently the *same value* as `medpass-dev`'s (bucket-level isolation is real — `medpass-prod-*` buckets are genuinely separate — credential-level isolation is not, since the Cloudflare API token available this session can create buckets but can't mint a new scoped R2 API token without dashboard access). Telnyx credentials and phone number/connection ID are also intentionally shared with dev — one vendor account, not duplicated per environment. This is infrastructure for a controlled, end-to-end pilot, not a full public launch: clinical validation, security review, legal/DPDP review, and DPO designation ([29](29-production-readiness-checklist.md)) remain open and are not bypassed by this deploy.

## Production topology

```mermaid
flowchart TB
    subgraph CF[Cloudflare]
        EDGE[Proxy + WAF + TLS]
    end
    subgraph RWP[Railway project: production]
        direction TB
        subgraph Public[Publicly exposed (via Cloudflare only)]
            PW[patient-web · Next.js]
            AW[admin-web · Next.js]
            API[api · NestJS]
        end
        subgraph Private[Private networking only]
            WK[worker · BullMQ consumers]
            CRON[cron jobs · one-shot]
            PG[(PostgreSQL)]
            RD[(Redis)]
        end
    end
    EDGE --> PW & AW & API
    PW -->|internal| API
    API --> PG & RD
    WK --> PG & RD
    CRON --> PG & RD
    API & WK -.->|S3 API over TLS| R2[(Cloudflare R2)]
```

- **Private networking** for: API→PG, API→Redis, worker→PG/Redis, web→internal API where appropriate, cron→internal services. Only web/API entry points are public. **PG and Redis are never publicly exposed and never routed through Cloudflare** (spec §11.8).
- All services: Dockerfile-based deploys, stateless (no permanent local files), graceful shutdown (SIGTERM drain: API stops accepting → drains requests; worker stops claiming → finishes/reschedules jobs), health-checked rollouts.

## Service configuration

| Service | Scaling | Health | Notes |
|---|---|---|---|
| api | Horizontal (2+ replicas prod) | `/healthz` liveness, `/readyz` readiness (PG+Redis probes) | Request timeout 30 s; body limit 1 MB (uploads go direct to R2) |
| patient-web / admin-web | Horizontal | Next.js health route | Personalized SSR marked no-store |
| worker | Vertical + queue-concurrency controls | Liveness = heartbeat key in Redis | Per-queue concurrency caps ([31](31-cost-and-capacity-model.md)) |
| cron | One-shot Railway cron schedules | Exit code + `background_jobs` record | Idempotent; overlap-guarded via Redis lock |
| PostgreSQL | Railway addon | storage/connection/slow-query/lock/growth monitoring + index review cadence | See hardening below |
| Redis | Railway addon | memory monitoring, eviction alerts | `noeviction` policy (queues must not silently drop); auth required |

### Cron schedule (initial)

| Job | Schedule |
|---|---|
| detect-due-reminders | * * * * * (sliding window, idempotent) |
| generate-refill-reminders | 0 6 * * * |
| reconcile-missed-doses | */15 * * * * |
| expire-share-links | */10 * * * * |
| cleanup-abandoned-uploads | 0 * * * * |
| content-freshness-check | 0 2 * * 0 |
| backup-export + verify-backups | 0 1 * * * / 0 3 * * * |
| restore-test | 0 4 1 * * (monthly) |
| retention-cleanup | 0 4 * * * |
| reconcile-stuck-jobs | */30 * * * * |
| operational-report | 0 7 * * * |
| review-pending-content / overdue-approval-nudges | 0 9 * * 1-5 |

## PostgreSQL hardening (spec §11.6 — a provisioned DB is not production-ready)

TLS where applicable; **PgBouncer-style pooling** (Prisma pool sizing per replica; total < instance max with headroom); roles: `app_rw` (DML only), `migrator` (DDL; used only by the migration step), `readonly` (masked views); migrations run as a gated pre-deploy step, never at container boot race; application-level encryption for direct identifiers; backups + PITR where available + restore testing ([27](27-backup-and-disaster-recovery.md)); monitoring: storage, connections, slow queries (`pg_stat_statements`), locks, growth; quarterly index review; retention enforcement via cron.

## Redis usage contract (spec §11.7)

Auth required; private only; namespaced keys (`q:`, `lock:`, `idem:`, `rate:`, `sess:`, `sync:`); explicit TTLs on all non-queue keys; minimal sensitive data (job payloads carry IDs, workers fetch PHI from PG; where a payload must carry sensitive fields it is encrypted); recovery: on Redis loss, queues rebuild from PG state (`background_jobs`, `scheduled_doses`) — **PG remains the source of truth**.

## Region (spec §11.9)

Initial: **Railway Southeast Asia (Singapore)** — closest suitable region; API, worker, PG, Redis co-located. Before launch, document: measured latency from Delhi/Mumbai/Bengaluru/Hyderabad/Chennai (target < 120 ms RTT via Cloudflare edge), region availability, data-residency implications (cross-border processing disclosed — **Singapore hosting does not automatically satisfy Indian privacy/healthcare obligations**, OD-2), subprocessors, failover limitations, and migration/recovery procedures ([27](27-backup-and-disaster-recovery.md) includes region-loss recovery). Re-evaluate if legal, residency, contracts, measured latency, or DR needs dictate (spec list).

## Deployment flow

```mermaid
flowchart LR
    PR[PR merged to main] --> CI[GitHub Actions:\nlint · typecheck · test · build · gitleaks · migration check]
    CI --> STG[Deploy staging\n(migrate → rollout)]
    STG --> SMOKE[Staging smoke + e2e + cache/WAF probes]
    SMOKE --> GATE{Manual approval}
    GATE --> PROD[Deploy production:\n1. migrator step\n2. rolling deploy w/ health gates\n3. post-deploy smoke]
    PROD --> WATCH[Alert watch window]
    WATCH -->|regression| RB[Rollback: previous image\n+ documented migration-rollback procedure]
```

Deployment tests (spec §24): health-gate verification, private-network reachability, migration forward/backward on staging clone.
