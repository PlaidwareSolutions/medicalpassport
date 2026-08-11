# Landing Page — Session 9A: Final Media Production (Candidates)

**Date:** 2026-08-11 · **Status:** ALL CANDIDATES AT `REVIEW` — nothing published to R2, no landing-page placeholder replaced, no commit. Awaiting the Session 9A gate; Session 9B (publish + integrate + deploy) starts only on approval.
*(Unnumbered by convention; SPEC reserves 06/07.)*

## FFmpeg (Session 9A ruling)

- Discovered absent; **installed via Homebrew** (`brew install ffmpeg`) as a local media-production prerequisite — a normal developer-tool install, no root, no repo dependency, no bundled binary, nothing committed.
- **ffmpeg/ffprobe 8.1.2**; relevant encoders present: `libx264` (H.264) and `libvpx`/`libvpx-vp9` (WebM). Note: this Homebrew build lacks the `drawtext` filter (fine — no burned-in text is used anywhere).

## Pipeline (raw → candidate)

`artifacts/marketing-media/raw/<id>.webm` (Session 8 deterministic recordings, VP8 390×844@25fps, no audio) →
1. **Frame inspection**: per-source contact sheets (`fps=2` tiles) reviewed before any edit — trim points and posters chosen from what is actually in the footage, never guessed.
2. **Trim** (clean head/tail only — no speed-ups, no transitions, no fake interactions): each clip's head cut past the SPA cold-load flash where one existed.
3. **Encode both delivery formats**, video-only (no silent audio tracks): MP4 `libx264 -crf 22 -preset slow -pix_fmt yuv420p -movflags +faststart -an` · WebM `libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -an`. Settings chosen by comparison (crf 20 vs 24 / 32 vs 38 on the same frames): static-UI screencasts are visually indistinguishable across that range, so the conservative middle was kept; UI text is pixel-crisp at every setting tested.
4. **Posters**: deliberately selected stable frames (never frame 0), JPEG q≈3.
5. **Decode verification**: all 12 encodes (6×MP4 + 6×WebM) played in real Chromium — 390×844 confirmed, playback advances.

## Candidates (all `REVIEW`)

| Clip | Duration | WebM | MP4 | Poster | Notes |
|---|---|---|---|---|---|
| hero-passport-en | 12.2s | 250KB | 273KB | 44KB | Montage: home → medicines → add/review → timeline → listen (Stop active) → caregiver scopes. **No sharing** (Stage 7); modular so a sharing beat can be added post-clearance |
| add-medicine-en | 6.6s | 148KB | 192KB | 45KB | Search → select Dolo 650 → typing-free pickers → reason → saved in passport; confirmation step fully visible; honest length (target said 8–12s; the real flow is 6.6s) |
| timeline-en | 9.0s | 73KB | 141KB | 44KB | Entered via Home → "View today's full schedule" (authentic path; also avoids the cold-load flash); morning/night slots; Taken → recorded |
| listen-en | 4.8s | 39KB | 41KB | 47KB | Listen → Stop state change; silent by policy |
| offline-en | 7.1s | 107KB | 197KB | 41KB | Offline banner → queued dose ("Saved on this device…") → resync; no offline reminders |
| caregiver-en | 6.2s | 88KB | 91KB | 50KB | Invite form + "What can they do?" bounded scopes; synthetic number |

Extras: **OG candidate** `og/og-home-en.jpg` (1200×630 — lockup + tagline + "Free for patients" chip + authentic product UI from current footage; MP monogram absent per the Session 4 ruling) · **R4 companion audio** `audio/hear-medicine-passport-en.mp3` — the shipped in-app guidance MP3 (`screen.home.en`, Chirp3-HD-Achernar; spoken text is existing product copy) proposed as the explicit user-initiated "hear how it sounds" asset; no new TTS generation, no new vendor, never autoplay. All under `artifacts/marketing-media/candidates/` (gitignored).

Descriptive transcripts for every clip live in the manifest (`e2e-marketing/storyboard-manifest.json`, `candidate.transcript`) — these are visual-description accessibility texts (the videos are silent); no fake dialogue VTT was created.

## Source fixes made this session (fix-the-flow, never Photoshop)

1. **Claim drift caught in frames:** manual `enteredName` seeding produced real `uncertain_normalization` findings → the clinically gated "Needs review" section appeared in footage. Fixed at the source: seeds are **catalog-linked** (`productId`), and the specs now assert `Needs review` has count 0 — a standing claim-gate guard in the framework.
2. **R3 cold-load flash:** re-scripted to enter via Home's real link (better footage, no artifact).
3. **R6 phone defect:** the field pre-fills "+91", so typing a full number rendered "+91+91…" — script now types subscriber digits only.
4. **Hero cut drift:** after re-records, montage cut points were re-derived from the *current* raws' contact sheets and the final MP4 re-inspected frame-by-frame.

## Privacy + claims review

Final candidates frame-inspected (contact sheets of the encoded outputs, not just raws): only "Asha Demo" / "Dr. Demo Mehta" / synthetic `+919800000002` / seed-catalog medicines appear; no real names, phones, documents, tokens, or internal URLs. No interactions, safety findings, SMS/WhatsApp, offline reminders, export/deletion, sharing, or non-English content is depicted (§25).

## Legibility

Candidates were reviewed at ~300px rendered width (the landing page's desktop phone-frame size, and mobile at 320–390px is the same pixel budget or better): medicine names, dose lines, Taken/Skip/Snooze buttons, offline banner, Listen/Stop chips and caregiver scope labels all read clearly. One cosmetic observation (not a blocker): the medicines-list schedule line prints the frequency label verbatim including its example text ("Custom pattern (e.g. 1-0-1) 1-0-1 · After food") — wordy in footage; recorded as a product observation, no app change made (§26).

## Session 9B design (prepared, not executed)

On approval: (1) compute content hashes → final names per the manifest's `finalTarget`s (`<name>.<hash8>.<ext>`); (2) inspect existing auth first — supervised local publish may use the existing wrangler OAuth; a persistent pipeline gets a **bucket-scoped R2 Object R/W credential** (minted then, never printed); (3) publish to `medidocs-marketing-assets` with explicit remote targeting — the publisher script must hard-fail if remote targeting is absent (the Wrangler v4 local-simulator default is the known trap) and set correct MIME types; hashed assets get `public, max-age=31536000, immutable` object metadata; (4) CSP additions on the marketing site (`media-src`/`img-src assets.medidocs.app`); (5) `PlaceholderMedia` → `ProductMedia` slot swaps (poster+sources); (6) staging deploy; (7) live verification (headers, sizes, playback, Save-Data poster path); (8) docs.

## Repository state

No binaries tracked: `artifacts/` is gitignored; `git status` shows no media. No R2 upload of any kind this session; `staging.medidocs.app` and all placeholders unchanged.

---

# Session 9B addendum — published & integrated (2026-08-11)

**Pre-publish cleanups (§0):** (A) the frequency-label repetition was a real product defect — `instructionSummary`/`scheduleSummary` in `apps/patient-web/lib/medications.ts` reused the *picker's* teaching label ("Custom pattern (e.g. 1-0-1)") as a display label and appended the pattern. Fix: when a pattern exists, display the pattern alone ("1-0-1 · After food"); the picker keeps its example. patient-web tests (14) + typecheck green; R1/R2/R6 re-recorded against the rebuilt app and re-inspected. (B) the full synthetic phone number was visible in R6/hero — no established fictional Indian range exists, the product doesn't mask the field, and painting footage is prohibited, so the deterministic flow was redesigned: **no number is typed on camera**; the footage shows scope checkboxes being chosen (the stronger story). Frame-verified: only the "+91" prefill ever appears.

**Published set** (bucket `medidocs-marketing-assets`, via the existing wrangler OAuth session, every upload `--remote` by construction and verified through the public origin — 200 + exact content-type + `immutable` cache-control + byte-length match):
`video/en/`: hero-passport-en (12.2s, mp4 268KB/webm 241KB) · add-medicine-en (6.3s, 203/164KB) · timeline-en (9.0s, 141/73KB) · listen-en (4.8s, 41/39KB) · offline-en (7.1s, 197/107KB) · caregiver-en (6.6s→6.2s trim, 125/116KB) — all 390×844, video-only, faststart. `images/posters/`: six deliberate stable frames (41–50KB JPEG). `images/og/og-home-en.a50d39e4.jpg` (1200×630). `audio/en/hear-medicine-passport-en.929abc46.mp3` (the shipped guidance voice). Hash-named (sha256[:8] of bytes); old objects never deleted; layout per §12. Statuses in the storyboard manifest: `PUBLISHED` (r7 sharing remains gated, unscripted; non-English media not produced).

**Publisher:** `apps/marketing-web/scripts/publish-media.mjs` — hardcoded exact bucket, `--remote` emitted by the script (cannot be omitted by a caller), unknown-MIME/missing-file/verification failures are fatal, writes `apps/marketing-web/lib/published-media.json` for the site. Auth: supervised local wrangler OAuth; a future automated pipeline should mint a bucket-scoped Object-R/W token (not created — no operational need yet).

**Integration:** CSP gained exactly `img-src … https://assets.medidocs.app` and `media-src 'self' https://assets.medidocs.app` (no wildcards; analytics beacon still deliberately blocked — Session 11). `SectionMedia` renders published `ProductMedia` (poster + WebM/MP4, transcript as the accessible label) and falls back to `PlaceholderMedia` for anything unpublished; S1/S4/S5/S6/S7/S8 all use real media; S6 additionally gained the explicit `AudioSample` control ("Hear how Medicine Passport sounds" — `preload="none"`, keyboard-accessible button, Listen/Stop state, quiet error state, never autoplay). OG meta now points at the published hashed image. Hero poster is `eager` (LCP), all other posters lazy.

**Live verification (staging, version `1b129bef`):** initial load fetches 6 posters + only the in-viewport hero video; the other five videos load progressively as sections approach (12 total media requests after full scroll); hero plays in viewport and pauses out of it; **reduced motion: zero `<video>` elements, zero video requests, six posters**; assets-origin-down drill: page keeps h1/copy/CTA with clean frames (no broken-video icons); 0px overflow at 390/1280; noindex header + disallow robots + empty sitemap still active; `/for-clinics/` still 404; only console error remains the intentionally blocked analytics beacon. First Load JS 109KB (was 103–105KB — the +4KB is the AudioSample client component and media map). Save-Data: implementation suppresses video via `navigator.connection.saveData` (the same code path as reduced-motion, which was verified live; Chromium's emulation of the saveData signal isn't faithful headlessly — reported honestly rather than faked).

**Remaining media gaps:** Stage-7 sharing clip (gated) · clinical-gated footage (none planned until Stage 6 clears) · hi/te/ur variants (translation-gated) · canonical illustration family (interim SVGs remain acceptable at staging quality — no redesign started).
