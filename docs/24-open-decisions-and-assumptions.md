# 24 — Open Decisions and Assumptions

Living register. Per spec §29: when uncertain we state the uncertainty, document the assumption, choose the safest reasonable option, and keep moving. Architecture Decision Records (ADRs) below are accepted unless revisited; Open Decisions (OD) block specific stages as noted in [22](22-implementation-plan.md).

## Accepted ADRs

| ADR | Decision | Rationale / safest-option notes |
|---|---|---|
| ADR-1 | Turborepo + **pnpm** workspaces | Spec mandates Turborepo; pnpm is the conventional, disk-efficient companion |
| ADR-2 | Next.js App Router for both web apps; **Serwist** for the service worker | Maintained successor to next-pwa; full Workbox control for PHI-exclusion cache rules |
| ADR-3 | NestJS + **BullMQ** on Redis for jobs | Spec mandates NestJS + Redis queues; BullMQ is the standard, supports retries/backoff/DLQ/concurrency controls |
| ADR-4 | **Prisma** ORM, migrations via `prisma migrate` run as a Railway pre-deploy step with a dedicated `migrator` role | Spec mandates Prisma; controlled migrations + least privilege |
| ADR-5 | Opaque server-side session tokens (hashed) over JWT | Immediate revocation is a hard requirement (caregiver revocation, session revocation); JWT statelessness fights that |
| ADR-6 | **Zod** shared validation (`packages/validation`) | One schema source for client + server + offline payloads |
| ADR-7 | UUIDv7 primary keys | Time-ordered (index locality) + opaque |
| ADR-8 | next-intl (web) over i18next | App Router-native; keys shared via `packages/localization` either way |
| ADR-9 | Provider adapters behind interfaces for SMS/WhatsApp/OCR/AI/interaction-data | Swappable vendors; dev uses log/fake transports (**Mocked**) |
| ADR-10 | GitHub Actions CI/CD deploying to Railway | Conventional; Railway-native integration |
| ADR-11 | No Cloudflare compute (Workers/KV/D1/DO/Queues/Vectorize/Workers AI) in MVP | Spec default; any exception needs the §7.2 five-condition ADR process |
| ADR-12 | R2 accessed via S3-compatible API from Railway (`packages/object-storage`), MinIO locally | Standard SDK; local parity |
| ADR-13 | Cron = Railway cron jobs running one-shot Node entrypoints from `apps/cron` | Finite start→work→exit per spec §11.5 |

## Open decisions (blocking noted)

| OD | Question | Owner | Blocks | Current assumption (safest) |
|---|---|---|---|---|
| OD-1 | Production domain names (placeholder `*.example.com`) | Product | Cloudflare setup | Placeholders until purchase |
| OD-2 | DPDP legal review + data-residency position for SE-Asia hosting | Legal | Production launch | Disclose cross-border processing; do **not** claim compliance; evaluate India-region options if counsel requires |
| OD-3 | Licensed Indian medication database vendor | Product + clinical | Stage 6 catalog scale-out | Ship Mocked seed catalog for dev only; never present as reviewed |
| OD-4 | Validated interaction/contraindication provider | Clinical | Stage 6 interaction checks | Interaction checks stay dark; fallback string shown; duplicates (own normalization) can ship |
| OD-5 | Railway region measurement (Singapore assumed) + latency from Indian metros | Eng | Production topology | Singapore; document latency before launch ([25](25-railway-deployment-architecture.md)) |
| OD-6 | Clinical lead appointment | Founders | Stage 6, all content approval | No clinical content published until appointed |
| OD-7 | Audit + data retention windows (regulatory input) | Legal | Retention crons | Audit ≥7 y, operational logs 90 d, dose history 24 mo online |
| OD-8 | ABDM onboarding timing (HIU/HIP) | Product | Post-MVP | Not required for launch |
| OD-9 | DPO / grievance officer designation | Legal | Launch | Required before public launch |
| OD-10 | SMS/OTP + WhatsApp BSP vendor (e.g. MSG91/Gupshup/Twilio class) | Eng | Stages 2 (real OTP), 4 | **Partially resolved: Telnyx selected for SMS, plus a real voice-call supplementary channel added this session.** `TelnyxSmsSender` sends real OTP codes and reminder texts (`OTP_TRANSPORT=sms`, SMS reminders gated by `sms_reminders` consent). Real SMS delivery is still **Requires platform configuration**: the connected number needs US toll-free verification (or a registered long code) submitted through the Telnyx portal, its messaging profile's destination whitelist needs expanding beyond US/CA, and India delivery additionally needs DLT/TRAI sender + template registration regardless of Telnyx-side config — none of these are API-completable. A delivery-status webhook receiver (`TelnyxWebhookController`, Ed25519-signature-verified) correlates the real delivered/failed outcome back to each send — visibility, not delivery, so it doesn't change any of the blockers above. **New this session: `OTP_TRANSPORT=voice`** (`TelnyxVoiceOtpSender` + `TelnyxVoiceWebhookController`, real Telnyx Call Control) places a genuine outbound call and speaks the code via TTS — live-verified with a real call to a real Indian mobile number, the human-reported code confirmed byte-for-byte via a real `/v1/auth/otp/verify` call. This is a *supplementary* channel, explicitly **not** a confirmed way around India's SMS DLT requirement: TRAI's TCCCPR rules also cover automated/bulk voice and IVR traffic, and whether an ad-hoc international Call-Control call is actually in scope wasn't resolved before building this — it was built anyway, deliberately, as redundancy. A separate, India-whitelisted outbound voice profile was created for this (the account's shared "Default" profile only allows US/CA and wasn't touched). Voice TTS only supports `hi-IN`/`en-IN` (Telnyx has no Telugu/Urdu voice) — those locales fall back to English. WhatsApp remains fully open: no WhatsApp Business Account connected. |
| OD-11 | OCR provider (handwriting + Indic scripts capability) | Eng + clinical | Stage 8 | Evaluate against Gate 5 corpus before selection |
| OD-12 | AI provider + no-training contractual terms | Eng + legal | Stage 8 | Adapter-based; provider must meet §15.3 checklist |
| OD-13 | Observability backend (OTLP-compatible) | Eng | Stage 11 | Structured logs + Railway metrics until chosen |
| OD-14 | PDF generation approach (headless Chromium in worker vs library) | Eng | Stage 7 | Worker-side headless Chromium assumed (no client PDF with PHI) |
| OD-15 | Turnstile placement tuning (which flows, thresholds) | Eng | Stage 11 | **Resolved for OTP request this session**: a real Turnstile widget (Cloudflare API-provisioned, "managed" mode — Cloudflare's own bot-risk assessment decides visible-challenge vs invisible-pass, satisfying "challenged when suspicious" without custom scoring) verified server-side via `verifyTurnstile`, covering both "login" and "recovery" purposes on the shared `/v1/auth/otp/request` endpoint. Live-verified: real widget execution in a browser, real server-side rejection of a missing token, and a real human completing the full flow successfully. Admin login still unresolved — no admin login endpoint exists in this codebase yet to challenge |

## Standing assumptions

1. Spec sections 1–25 + pasted Stages 8–11/§26–30 are the complete requirements; no other truncated content exists.
2. `app/api/admin/share/assets.example.com` naming will map 1:1 onto the real domain (OD-1).
3. MVP targets India (+91 phone format default) but does not block other country codes at the auth layer.
4. Hindi/Telugu/Urdu launch content will be professionally translated before public launch; English is the authoring master.
5. Caregiver invitations require the caregiver to hold their own OTP-verified account (no shared credentials).
6. Browser localStorage/IndexedDB cannot be assumed encrypted; treated as semi-trusted with documented limits until native phases.
7. Development seed data is synthetic; any real-prescription OCR corpus will be consented or synthetic (Gate 5).
