# Landing Page — Session 8: Media Recording Framework

**Date:** 2026-08-11 · **Status:** WORKING — all six ungated flows record deterministically; raw sources only, nothing edited, transcoded, published, or embedded. Awaiting the Session 8 gate.
*(Unnumbered by convention; SPEC reserves 06/07.)*

## Architecture

Lives inside `apps/patient-web` as a **separate Playwright project** — the recordings drive the real patient app, so the framework sits beside (never inside) the e2e suite it reuses patterns from:

- `playwright.marketing.config.ts` — dedicated config: `testDir: e2e-marketing/`, Chromium, **1 worker, 0 retries**, mobile emulation (viewport **390×844**, touch, DSF 2), `locale: en-IN`, `timezoneId: Asia/Kolkata`, video `on` explicitly sized **390×844** (verified: every raw WebM is exactly 390×844 — Playwright does not preserve viewport size by default, so the size is explicit). Output isolated to `artifacts/marketing-media/test-results/`.
- `e2e-marketing/global-setup.ts` — seeds the synthetic demo account through the real API (same fixed-OTP mechanism as the e2e suite).
- `e2e-marketing/record.helpers.ts` — `hold()` (short uniform presentation pauses; editing pace belongs to Session 9), `snap()` (privacy-review stills per flow), `saveRecording()` (finalizes the WebM into `artifacts/marketing-media/raw/<id>.webm`).
- `e2e-marketing/r1…r6-*.spec.ts` — one deterministic flow per recording, tagged `@rN-…`; each asserts real product state (fails loudly on drift) and never uses long arbitrary sleeps.
- `e2e-marketing/storyboard-manifest.json` — the machine-readable manifest driving Session 9 (IDs, sections, gates, durations, states, scripts, final-target names — including the **gated, unscripted** `r7-share-doctor` entry).

**Recording source decision (Session 8 §4):** the **locally launched real stack** (built API on :4000 + built patient-web on :3000 — the exact `webServer` mechanism the e2e suite already uses), *not* staging. Staging was ruled out for cause: Turnstile correctly blocks headless automation there (verified in earlier sessions — the control working), and a shared environment can't be a deterministic studio. Same product code, synthetic data only, zero effect on staging users. No new infrastructure was invented.

## Synthetic demo identity (§5 — every seeded field)

| Field | Value |
|---|---|
| Profile displayName | **"Asha Demo"** (unmistakably synthetic) |
| yearOfBirth / locale | 1962 / en |
| Phone | fresh random `+9198XXXXXXXX` per run (fake range; new account per run = trivially idempotent reset; **never visible in any recorded flow**) |
| Prescriber | "Dr. Demo Mehta" (self-labelling fiction) |
| Seeded medicines | **Amlong 5** (1-0-0, any food, qty 28, "Blood pressure") · **Glyciphage 500** (1-0-1, after food, qty 30, "Blood sugar") — both from the verified dev seed catalog |
| Added live by R2 | **Dolo 650**, SOS ("Only when needed"), reason "Fever" — SOS so the scheduled timeline stays deterministic for R1/R3 |

No real patients, prescriptions, reports, phone numbers, or personal data anywhere. Catalog entries only — nothing implies a comprehensive database; no clinically gated feature (interactions/safety findings) appears in any flow.

## Time strategy (§7)

`timezoneId: Asia/Kolkata` fixed at the context level; schedule slots derive from the seeded patterns (morning/night), so the timeline renders consistently regardless of run time. Playwright's Clock API (available in the installed 1.62) was deliberately **not** applied: due-ness derives from server-computed data, so freezing only the client clock would desynchronize UI and API — the least-invasive rule wins. If Session 9 needs a pinned on-screen date, the documented option is Clock API **plus** seeding times relative to the frozen instant; no production code is modified for fake dates.

## Flow status

| ID | Flow | Status |
|---|---|---|
| R1 | Hero sources (home → medicines → timeline → listen; **no sharing beat** — modular slot reserved post-Stage-7) | **Recorded** (9.8s raw) |
| R2 | Add medicine — search → review → confirm → saved (**the proof**; run 3×, materially identical) | **Recorded** (6.5s raw, 363KB) |
| R3 | Timeline + Taken action | **Recorded** (3.9s) |
| R4 | Listen/read-aloud, **English only**; Listen→Stop state change verified; no invented captions | **Recorded** (5.2s) |
| R5 | Offline view + queued dose + resync via `context.setOffline` (no DevTools chrome; no offline reminders shown) | **Recorded** (7.4s) |
| R6 | Caregiver invite + bounded scopes (synthetic invitee `+919800000002`; local `log` transport — nothing sent) | **Recorded** (6.4s) |
| R7 | Share/doctor QR | **GATED — Stage 7; documented in the manifest, deliberately unscripted** |
| — | hi/te/ur variants of anything | **GATED — professional language review; framework locale-capable, none generated** |

## Commands

```bash
pnpm --filter @medpass/patient-web marketing:record                    # all ungated flows
pnpm --filter @medpass/patient-web marketing:record:add-medicine       # R2 only
pnpm --filter @medpass/patient-web exec playwright test \
  --config=playwright.marketing.config.ts e2e-marketing/r5-offline.spec.ts   # any single flow
```

Each run: seeds a fresh synthetic account → authenticates via real OTP (fixed dev code) → drives the real UI → saves `artifacts/marketing-media/raw/<id>.webm` + `<id>-frames/*.png` privacy stills → fails loudly on product drift. Prereqs: local Postgres, `apps/api/dist` and patient-web `.next` built (the config's `webServer` launches both).

## Privacy rules (§19)

Every flow saves review stills at its key moments; the R2 stills were frame-inspected this session — no phone numbers, no real names, no documents, no tokens/debug values in frame. Standing rule: **a recording containing real personal information is a failed artifact** and must not reach Session 9. The demo identity is documented above; nothing else may appear.

## Isolation guarantees (§13/§15)

`artifacts/` is gitignored (raw video can never be committed); nothing enters `public/` or R2; traces/screenshots live under `artifacts/marketing-media/test-results/`, separate from `raw/`. The normal e2e config is untouched — `playwright test --list` still enumerates exactly the 307 tests in 5 files; CI never invokes the marketing config; the marketing storage state lives in `e2e-marketing/.auth/` (gitignored path pattern), never in application code.

## Known limitations / Session 9 requirements

- **ffmpeg is not available** in this environment (checked; not installed per instruction). Session 9 owns: transcode WebM→MP4/H.264 + optimized WebM, poster extraction, cropping/duration edit to the 8–15s targets, caption/transcript files, hash-versioned filenames, and R2 publishing (remember: `wrangler r2 object put` needs `--remote`, or use the S3 API — the bucket-scoped Object R/W credential is minted then, per Session 6's credential plan).
- R4 captures the *visual* state change; produced audio isn't in the screencast — Session 9 decides how listen audio is represented (e.g., overlay caption or recorded audio track policy).
- Hero final montage is an edit of R1 beats (+ later a sharing beat post-Stage-7), not a re-recording.
- Raw durations (3.9–9.8s) intentionally leave editing room; nothing was artificially sped up.
