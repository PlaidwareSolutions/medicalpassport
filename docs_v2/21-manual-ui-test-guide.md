# V2 manual UI test guide

What was built, how to run it on a laptop, what to click, and what must
never appear on screen. Written 2026-09-06 against branch `v2`. Automated
coverage exists for most of this (see §6), but a person should still walk
these journeys once: the automated suites check that screens work, not that
they make sense to a patient.

Everything in §3 is a **test case**. Each has the steps, what you should see,
and, where a hazard applies, a **"must never"** line. A must-never failing is
a safety defect, not a cosmetic one.

---

## 1. What was built

### Patient app (`apps/patient-web`)

Where to find the new areas without typing an address: **Home** has a "My
health record" card with tiles for the health record, documents, test
results, measurements and family; the **Add** tab offers a document or scan,
a test result, a measurement and a doctor visit below the medicine search;
**Profile** lists measurements, documents, who can see the record, and ABHA
alongside the existing rows. The bottom bar is unchanged.


| Area | Screens | What it does |
|---|---|---|
| Health record | `/health`, `/health/visits`, `/health/visits/new`, `/conditions`, `/conditions/[id]`, `/allergies`, `/immunizations`, `/procedures`, `/family-history`, `/doctors`, `/organizations`, `/profile/health-details` | Longitudinal timeline with a trust badge on every event; visits; clinical profile; the condition hub with the treatment journey |
| Medicines | `/medicines`, `/medicines/[id]`, `/medicines/[id]/edit`, `/medicines/confirm-type` | Medicine detail now carries "why · who · since when · changes" and a refill plan that states a run-out date |
| Prescriptions | `/prescriptions`, `/prescriptions/new`, `/prescriptions/[id]` | Line items; "Start this medicine" per line; diagnosis, validity, follow-up |
| Documents | `/documents`, `/documents/new`, `/documents/[id]`, `/documents/[id]/review`, `/documents/[id]/discharge`, `/share-target`, `/add/scan` | Capture → upload → "what is this?" → per-candidate review → save; discharge summaries get an explanation screen instead |
| Tests | `/reports`, `/reports/new`, `/reports/[id]`, `/reports/trends/[analyteKey]`, `/reports/values` | Structured lab and imaging entry; trends with a table alternative |
| Measurements | `/measurements`, `/measurements/[concept]`, `/measurements/[concept]/trends`, `/measurements/devices`, `/measurements/checkups` | Per-concept diaries and trends; old `/blood-sugar`, `/blood-pressure`, `/body-weight` redirect here |
| Caregiving | `/family`, `/activity`, `/caregivers`, `/caregivers/new`, `/caregivers/[id]/edit`, `/caregivers/invitations`, `/profile/notifications` | Family dashboard limited to what your scopes grant; who-changed-what; seven new scopes; per-kind notification controls |
| Sharing | `/share`, `/share/new`, public `/s/[token]` | New sections, audience, expiry presets, preview; doctor snapshot; document page access when chosen |
| Providers | `/proposals`, `/proposals/[id]`, `/connections`, `/connections/code` | Inbox of everything a clinic, pharmacy, lab or hospital proposed; accept per line; show a code at a clinic |
| ABHA / ABDM | `/abha`, `/abha/care-contexts`, `/abha/consents`, `/abha/records` | Link, discover, consents (separate from the app's own shares), imported records into the review queue. Runs against a **mock gateway** locally |
| Existing | `/`, `/timeline`, `/safety`, `/profile`, `/help`, `/tour`, `/offline`, onboarding, login | Unchanged in purpose; home gained a "waiting for you" card |

### Provider portal (`apps/provider-web`, new, port 3003)

`/login` (phone OTP) · `/` patients · `/organization` members (owner only) ·
`/patients/add` (scan or paste a patient's code) · `/patients/[linkId]`
snapshot · per patient: `reconciliation`, `prescription`, `encounter`,
`dispense`, `diagnostic-report`, `discharge` · `/proposals/[id]` status.
Which of those a portal offers depends on the organisation's kind.

### Admin portal (`apps/admin-web`, port 3001)

New pages: `/configuration` (feature flags), `/support` and `/support/[id]`
(cases, notes, break-glass), `/consent-audit`, `/documents` (processing
funnel), `/abdm`, `/fhir`, `/integrations`, `/notification-failures`. No
clinical values appear on any admin page; ids are opaque.

### Services and packages

API modules for every area above (306 operations pinned in
`apps/api/openapi.json`); `apps/abdm-gateway` (callbacks, mock mode);
`apps/worker` document classify/extract with retry backoff; crons for
test-due, measurement reminders, caregiver kinds, backfills;
`packages/fhir` (every priority artifact on IG v6.5 and v7.0, plus the
Indian Patient Summary), `packages/terminology`, `packages/provenance`,
`packages/health-events`, `packages/document-intelligence`,
`packages/field-crypto`, `packages/clinical-rules`; an ESLint gate.

---

## 2. Setup

### Stack

```
docker compose up -d                       # Postgres, Redis, MinIO
pnpm install
pnpm db:generate
DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass pnpm --filter @medpass/database exec prisma migrate deploy
DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass pnpm db:seed        # sample medicine catalog — needed for name matching
pnpm build
```

Environment for the API, worker and cron (put in `apps/api/.env` or export):

```
DATABASE_URL=postgresql://medpass:medpass@localhost:5432/medpass
OTP_HASH_PEPPER=dev-otp-pepper
SESSION_TOKEN_PEPPER=dev-session-pepper
ADMIN_PASSWORD_PEPPER=dev-admin-pepper
FIELD_ENCRYPTION_KEY=dev-field-key-must-be-32-bytes!!
OTP_TRANSPORT=log
OTP_DEV_FIXED_CODE=000000
OBJECT_STORAGE_ROOT=<absolute path, the SAME for api and worker>
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3003
```

Run, in separate terminals:

```
node --env-file=apps/api/.env apps/api/dist/main.js              # API :4000
node --env-file=apps/api/.env apps/worker/dist/main.js           # worker (documents need it)
pnpm --filter @medpass/patient-web start                          # :3000
pnpm --filter @medpass/provider-web start                         # :3003
pnpm --filter @medpass/admin-web start                            # :3001
```

`pnpm dev` runs all of them in dev mode instead.

### Logins

| Who | How |
|---|---|
| Patient | Any `+91…` number. OTP is always `000000` (log transport). Step-up prompts use the same code. |
| Second patient / caregiver | Use a different `+91…` number in a private window. The OTP send cap is 5 per number per hour and 10 per IP; if you hit it, clear `rate_limit_buckets` in Postgres. |
| Provider | Seed an organisation first (no self-serve creation exists): `pnpm --filter @medpass/provider-web seed:dev-org -- --kind clinic --name "Sunrise Clinic" --phone +919000000001` with the same `DATABASE_URL`, `OTP_HASH_PEPPER`, `FIELD_ENCRYPTION_KEY` as the API. Repeat with `--kind pharmacy`, `laboratory`, `hospital` and different phones. Then log in at :3003 with that phone and `000000`. |
| Admin | `ADMIN_BOOTSTRAP_PASSWORD=… ADMIN_PASSWORD_PEPPER=… pnpm db:seed-admin` (refuses if any admin exists). First login at :3001 walks you through TOTP enrolment with a QR code; use any authenticator app. |

### Test data you will want

A patient with: two medicines (one with a schedule), one prescription with
two line items, one condition ("Type 2 diabetes mellitus" — the journey
screen recognises it), a few blood pressure and glucose readings over
several days, one lab report with an HbA1c value, and one uploaded
prescription photo. `apps/api/test/fixtures/prescription-page-1.png` is a
usable test document.

---

## 3. Test cases

Mark each ✅ / ❌ / ⚠️. Record the locale you tested in.

### 3.1 Sign-in and step-up

1. Sign in with a new number. → Onboarding creates a profile.
2. Go to `/share/new` and create a link. → A step-up sheet asks for the code before creating. Cancel it. → The screen says nothing was changed, not a generic error.
3. Enter `000000`. → Link created. Do a second step-up action within 10 minutes. → No second prompt.

### 3.2 Health timeline and clinical profile

1. `/health` with an empty record. → An empty state with a teaching sentence, not a blank.
2. Add a condition, an allergy, a visit. → Each appears on `/health` with a trust badge stating where it came from ("You entered this").
3. Open `/health/visits/[id]`. → Visit detail, linked items.

**Must never:** a timeline event without a provenance badge.

### 3.3 Medicines

1. Add a medicine from the catalog. → Typing-free dose, frequency, food pickers.
2. Open its detail. → A "Why · who · since when · changes" block. Pick a condition and a doctor; set a planned stop date; reload. → All three persist (the API echoes them).
3. Refill plan: enter pack size 30 and 20 on hand with a once-daily schedule. → A plain sentence: "expected to last until <date>".
4. Change the route or strength text. → Saved; the history shows the change as a new entry, the old one kept.

**Must never:** any wording that tells the patient to buy or order medicine.

### 3.4 Prescriptions and line items

1. `/prescriptions/new`: add diagnosis, validity, follow-up and two lines (name only on one, full dose on the other). → Saves.
2. Open the prescription. → Lines in order, dose shown or "not written".
3. "Start this medicine" on the full line. → Sheet pre-filled; confirm. → A medicine exists and the line links to it.
4. "Start this medicine" on the name-only line. → The sheet asks for the dose with pickers; leave it blank and confirm. → Refused with the field highlighted.
5. Start the same line again. → Refused with a link to the existing medicine.

**Must never:** a dose guessed or defaulted on the patient's behalf (H-02).

### 3.5 Documents

1. `/documents/new`: add two pages from files (use the fixture), reorder, remove one, re-add. Upload. → Progress per page.
2. Wait for "What is this?" (worker must be running). → A guess with confidence wording ("Looks like a prescription — is that right?") and a grid of kinds.
3. Choose a different kind than the guess. → Your choice wins; detail shows the classifier's guess separately.
4. Review: → Groups with "Looks right?" (pre-selected), "Please check", and a collapsed "Other things we saw" that is never pre-selected. The page image shows the focused candidate outlined when the extractor supplied a region.
5. A lab value shows value and unit as **two** confirmable rows.
6. Correct one candidate, reject one, "Save all confirmed". → Done screen links to what was created; the medicine exists in `/medicines`.
7. Upload a document and choose "Hospital discharge". → An explanation screen. **Must never:** an "add these medicines" action anywhere on it (H-34).
8. `/documents` filter by kind; open detail; delete. → Soft-deleted, gone from the list.
9. `/add/scan` from the home tile. → Lands in the new flow with prescription pre-selected.
10. Share target (Android, installed PWA only): share an image to the app. → It asks whose document it is before anything uploads (H-38). Skip on desktop.

**Must never:** a dose quantity offered as a candidate; a candidate saved without the patient confirming it.

### 3.6 Tests (diagnostics)

1. `/reports/new`, kind "Laboratory": pick HbA1c, enter value as printed, pick a unit (only that analyte's units offered), enter the printed range. Save.
2. Open the report. → Value exactly as entered; the usual unit alongside only if different; the lab's own flag shown as plain text only if the lab printed one.
3. Add a second report a month later. `/reports/trends/hba1c`. → Unit on the axis, every point, a neutral band from the printed range, a "show as table" alternative, unconvertible values listed separately with their own unit.
4. Imaging kind. → Modality, body site, impression, findings fields instead of results.

**Must never:** a high/low/normal badge, colour, or arrow computed by the app for a patient-entered value (H-39/H-40). The only flag allowed is the one the lab printed, as text.

### 3.7 Measurements

1. `/measurements` hub. → One card per concept with the latest value, its context and the local time.
2. Blood pressure diary: add systolic/diastolic/pulse with posture. Glucose: value plus meal context. Temperature: °C and °F. Pain: 0–10 with large labels. → Each saves and shows in its diary.
3. Trends: switch 7d/30d/90d and day/week/month. → Chart plus table; morning/evening split for BP.
4. Visit `/blood-sugar`. → Redirects to the glucose diary.
5. `/measurements/devices`: add a manual device. → Saved; a sentence says Bluetooth sync arrives later.
6. Enter an impossible value (e.g. SpO2 140). → Refused by the API with a clear message.

**Must never:** any interpretation ("high", "low", "good") next to a reading.

### 3.8 Caregivers, family, activity, notifications

1. As patient A, `/caregivers/new`: invite patient B's number with **only** "See test results" and "Add measurements". → The scope list groups plain-language lines; ticking "Manage other caregivers" shows a warning that it lets the person bring others in.
2. As B, accept. `/family`. → A's card shows only what those scopes grant; other fields say "you do not have access to this", never blank or zero.
3. As B, open A's `/medicines`. → The add action is hidden/disabled with an explanation, not a failing request.
4. As B, add a measurement for A. As A, `/activity`. → A row naming B and what changed, in words. **Must never:** an id or an action code on this screen.
5. As A, `/profile/notifications`. → Per-kind frequency (right away / once a day / off) and channels. Dose reminders and caregiver escalation read as "Always on" with a reason — **must never** be a switch that can be turned off (H-48).
6. As A, edit B's scopes to remove "See test results". As B, `/reports` for A. → Explained, not a 403 page.

### 3.9 Sharing

1. `/share/new`: pick sections including measurements and documents, audience "Doctor", expiry "24 hours". → A preview of exactly what the recipient will see before creating.
2. Open the public link in a private window. → Snapshot with medicines, allergies, conditions, recent changes, latest results with units, 30-day measurement aggregates, and document pages if you chose documents.
3. Create a link **without** documents; try a document page URL from it. → Refused, and the attempt appears in the link's access log.
4. Revoke the link. → Public URL stops working.
5. A link created before this release (if you have one). → Still works and shows the same sections as before, never more.

**Must never:** a caregiver's name, user id, or any id-shaped key on the public snapshot (H-33).

### 3.10 Provider portal and proposals

Seed a clinic, a pharmacy, a lab and a hospital (§2). Patient A is logged in on :3000.

1. As A, `/connections/code`: choose sections and "1 hour". → A QR and the same code in large characters, with one sentence saying what the clinic will see and for how long.
2. Provider (clinic) at :3003: log in, `/patients/add`, paste the code. → A appears in the patients list with a label only.
3. Open A's snapshot. → Only the sections A chose. Actions offered: reconciliation, prescription, encounter — **not** dispense, report or discharge.
4. Send a reconciliation: STOP one current medicine, CONTINUE another, START a new one. → "Awaiting the patient's acceptance". STOP lines are visually separated; a STOP line carries no dose.
5. As A, home shows a "waiting for you" card; `/proposals` lists it naming the clinic. Open it. → Four plain-language groups. Decline the STOP line; accept (step-up). → The new medicine exists, the continued one is unchanged, the "stopped" one is **still current** because it was declined.
6. Provider `/proposals/[id]`. → Status accepted; the declined line visible.
7. Pharmacy portal: only "dispense" is offered. Send one for a medicine; A accepts. → A's on-hand quantity increased and the refill plan's run-out date moved.
8. Lab portal: only "diagnostic report". Send a result; A accepts. → Appears in `/reports` with a "from a lab" trust badge.
9. Hospital portal: discharge transition. Every current medicine must be decided; try sending with one undecided. → Refused. Send with a STOP; A accepts. → That medicine is stopped, reminders gone, nothing new created for STOP lines (H-34).
10. As A, `/connections`: revoke the clinic (step-up). Provider snapshot. → Gone.
11. Try a patient session token against a provider route, and vice versa. → Rejected.

**Must never:** any clinical table changing before the patient accepts; a STOP line rendering as something being added.

### 3.11 ABHA (mock gateway)

1. `/abha` → "Not linked". Link by mobile → OTP → linked; number shown masked.
2. Discover; link care contexts. `/abha/records` shows a received bundle. Import. → Lands in `/documents/[id]/review`, nothing written to medicines yet.
3. `/abha/consents`: visibly a different screen from `/share`; revoke one (step-up).
4. Unlink. → The screen says imported records stay and keep their provenance; they do.

### 3.12 Condition hub and treatment journey

1. `/conditions/[id]` for "Type 2 diabetes mellitus" with a medicine, glucose readings and an HbA1c. → The caveat "shows things that happened around the same time, not that one caused the other" sits above the content and on every before/after block.
2. A suggested link ("Is Metformin taken for Type 2 diabetes?") renders as a **question** with Yes/No. Answer No. → It disappears and does not come back on reload.
3. Before/after block. → Values around the start and at ~30 and ~90 days with the windows stated.

**Must never:** a percentage change, an arrow, a "worked/improved" word, or the suggestion shown as a fact.

### 3.13 Admin portal

1. First login enrols TOTP via QR; subsequent logins ask for the code.
2. Visit every nav page. → Renders; no clinical values; ids truncated.
3. `/configuration`: create a flag with a note. → `/audit` shows the change with the note.
4. `/support`: create a case for an opaque profile id; add a note; request break-glass with a reason under 10 characters. → Refused. With a proper reason, 30 minutes, and a fresh TOTP. → Granted; `/audit` shows it; the patient sees a notification "an administrator viewed your record".
5. `/documents`: funnel counts match what you uploaded in 3.5.
6. `/abdm` and `/fhir` show the mock transactions and any validation failures from a FHIR export.
7. Log in as an admin with only `users_view`. → The new pages are absent from the nav and return 403 by URL.

### 3.14 Localization and accessibility

1. Switch to Hindi, Telugu, Urdu on `/`, `/documents/new`, `/proposals`, `/conditions/[id]`. → No English keys like `documents.guess_high` visible; no `{name}` placeholders; Urdu is right-to-left.
2. Narrow the window to 320 px and set text size to 200 %. → No horizontal scroll on any screen you tested.
3. Tab through a full flow (add medicine) with the keyboard only. → Every control reachable; the step-up sheet traps focus and closes on Escape.

The hi/te/ur strings are **drafts**. Read them as a native speaker if you can; note anything that reads as advice, as a verdict, or as optional where it must be mandatory (for example "stop taking").

### 3.15 Offline

1. Load `/medicines`, go offline, reload. → The offline screen or the cached list, not a browser error.
2. Record a dose offline; go online. → It syncs.
3. Add a measurement offline. → **Known gap:** this is not queued; it is lost. See §4.

---

## 4. What is missing

### Engineering gaps with no external dependency (my proposed order)

Found by reconciling every plan row against the code on 2026-09-06.

1. **Key rotation misses three encrypted columns** — emergency-contact phone, organisation phone, ABHA number. Running the rotation runbook and retiring the old key would make them unreadable. Fix in `apps/cron/src/jobs/rotate-field-encryption.ts` plus a test that enumerates every `*_ciphertext` column in the schema.
2. **Audit writes on read paths** behind one global lock (open incident remediation, ticket 0.18).
3. **Offline sync does not cover measurements or document captures** (§14 of the API contract); they are lost offline.
4. **CI does not run on the `v2` branch**, and there is no scheduled Windows job (ticket 0.10).
5. **A stray empty migration folder** (`20260906165304_…`) duplicating a real one.
6. **No antivirus scan on any upload path** (P3-3).
7. **No security-header regression test**; the headers are wired where the test harness cannot reach them (ticket 0.19).
8. **Gate 3 alert-quality dashboard** in admin (P9-4): the data exists, the page does not.
9. **Guidance audio entries stop at the V1 screens**; the entry list is code, the MP3s need a key.
10. **Provider and marketing dev ports collided** on 3002 — fixed in this commit (provider-web is 3003).
11. Adapter interfaces the plan scoped as buildable before a vendor is chosen: medicine catalog (P2-6), OCR and AI provider (P3-2), device connector (P5-5).
12. **Voice entry** (P16) — no external dependency, entirely unbuilt.
13. Product metrics: the event schema exists, nothing emits it (P1-7).
14. Contract doc drift: `documents/*`, `medication-reconciliations`, `admin/providers` ship under different paths than `05-api-contracts-v2.md` says; the share-target server endpoint was replaced by a client-side flow.

### Blocked on an outside party

Clinical intelligence (licensed catalog OD-3, interaction provider OD-4, clinical lead OD-6); real ABDM sandbox (NHA, ticket 0.8); lab API partner; pilot clinics; WhatsApp BSP (OD-10); OCR/AI vendors (OD-11/12); pen test; the four governance boards; DPIA sign-off (counsel); staging environment and production check gate (Railway access).

### Blocked on review

Native review of ~900 draft hi/te/ur strings (H-19); Gate 4 clinical validation of new copy; Gate 1b terminology review; the six additional locales need professional translators.

**Am I preparing the engineering gaps?** The list above is the plan, in that order. Items 1–5 and 10 are small and I would start with them. I was told to stop before starting; nothing below item 10 has been touched.

---

## 5. Test environment caveats

- On Windows, Telugu overflows 320 px by about 7 px because only Nirmala UI is installed; CI has Noto fonts. Not a product bug.
- `next build` hangs if it shares `.next` with a running `next dev`; build with `NEXT_DIST_DIR=<dir>`.
- Playwright reuses whatever is on :3000 unless `E2E_BASE_URL`/`E2E_API_URL` point elsewhere, and `--grep` silently skips tests (a regex `lastIndex` bug); run sweeps unfiltered.
- Run the Playwright suite with `DATABASE_URL`, `OTP_HASH_PEPPER` and `FIELD_ENCRYPTION_KEY` in the environment (the proposals spec seeds a clinic through the database) and start the API under test with `RATE_LIMIT_DEV_MULTIPLIER=20`, or the 10-per-hour per-IP OTP cap fails the later specs with 429. Never start a second Playwright run while one is in progress: its global setup rewrites the fixture the running one reads.
- The local dev database has no `_prisma_migrations` table, so `migrate deploy` reports P3005 there; apply migration SQL directly. A fresh database applies them normally.

---

## 6. Where the automated coverage is

| Suite | Count | Covers |
|---|---|---|
| API e2e (`apps/api/test`) | 70 suites / 662 tests | every endpoint above, including the must-nevers that are server-enforced |
| Playwright (`apps/patient-web/e2e`) | 17 feature specs + axe/reflow/guidance sweeps and an exploratory crawl (uncaught errors, 5xx, verbatim dictionary keys, unfilled params, dead links) over ~70 routes × 4 locales; 982 tests | the journeys in §3.2–3.12 and 3.14 |
| Provider-web (`apps/provider-web/e2e`) | 1 full clinic workflow | §3.10 steps 1–6 |
| Package tests | fhir 427, document-intelligence 134, authorization 57, cron 63, worker 93, others | serializers, extractors, the scope matrix, reminders, queue |
| Admin portal | a login-through-the-real-screen crawl of all 18 nav pages (scratch script, 2026-09-06: 18/18 clean) — not yet a committed suite | §3.13 remains the checklist until that crawl becomes a spec |
