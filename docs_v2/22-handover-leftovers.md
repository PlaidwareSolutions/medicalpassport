# 22 — Handover: what is left, who does it, and how

Written 2026-09-07 when the last engineering ticket with no outside dependency closed. Everything below needs a person, a credential, a contract, a review, or a decision that engineering cannot take. Each item says what it is, why it exists, and the exact steps. Items are ordered the way they unblock each other.

Status vocabulary: **Decision** (owner chooses) · **Platform** (owner with a token, minutes to hours) · **External** (a third party) · **Review** (a qualified person reads and signs).

## Part A — get V2 deployed somewhere you can click on

### A1. Push the `v2` branch and let CI run — Platform

All V2 work is committed locally on `v2` and has not been pushed, at your instruction. When you are ready:

```
git push origin v2
```

Then watch `https://github.com/PlaidwareSolutions/medicalpassport/actions`. CI on `v2` runs the same gate as `foundation` (migrate check, build, typecheck, lint, OpenAPI check, all tests, Playwright accessibility suite, provider-web e2e). The last green run on the earlier commits was run 64; the new commits add many tests, so expect 25–35 minutes. If a step fails, paste the log to me as before.

Nothing deploys from a push to `v2` today: both Railway projects track `foundation`.

### A2. Decide where V2 is deployed first — Decision

Three options; pick one.

| Option | What happens | Cost | My recommendation |
|---|---|---|---|
| 1. Point `medpass-dev` at `v2` | Edit `.railway/railway.ts` line with `branch: "foundation"` to `branch: "v2"`, plan, apply. The existing dev URLs (`staging-*.medidocs.app`) start serving V2 | none | **Yes, first.** Fastest way to click through V2 on real infrastructure |
| 2. Create `medpass-stg` | New Railway project from `.railway/railway.stg.ts` (`staging-*.medicinepassport.app`, own DB and buckets) | a second paid environment, roughly the same as dev | Later, before external testers |
| 3. Merge `v2` → `foundation` | Production deploys V2 to real pilot patients | none, but irreversible for their data | **Not yet.** Only after option 1 or 2 has been used for a soak and the five backfills (A5) have been rehearsed |

For option 1, the commands (tokens stay in `.dev-data/secrets.env`, never in chat):

```
set -a; . .dev-data/secrets.env; set +a
node node_modules/railway/dist/iac/bin.cjs config plan  --file .railway/railway.ts --token "$RAILWAY_API_TOKEN" --project-id 01d4de40-b763-4378-94c8-0f71bdd47246 --environment-id 159b1b9a-4d95-4cd9-8dde-47e4cd9c6195
node node_modules/railway/dist/iac/bin.cjs config apply --file .railway/railway.ts --token "$RAILWAY_API_TOKEN" --project-id 01d4de40-b763-4378-94c8-0f71bdd47246 --environment-id 159b1b9a-4d95-4cd9-8dde-47e4cd9c6195
```

Read the plan before applying. The last dev plan showed 7 creates/sets and 0 deletes; a plan that proposes deleting a variable means a `preserve()` is missing, so stop and tell me.

### A3. Secrets the new services need — Platform

Set on Railway with `railway variable set --stdin` (or the dashboard), never committed. Generate with `openssl rand -base64 48`.

| Variable | Service | Why |
|---|---|---|
| `SHARE_TOKEN_PEPPER` | api | peppers share-link hashes (P7); old links still verify without it, new ones need it |
| `ABDM_INTERNAL_TOKEN` | api and abdm-gateway (same value) | the gateway's callbacks into the api are accepted only with it |
| `PRODUCT_EVENT_PEPPER` (optional) | api | separates the product-metrics profile digest from the session pepper; falls back to a derivation if unset |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | provider-web | the clinic portal's own Turnstile widget (A4); the login form renders no widget until set |
| `MIGRATOR_DATABASE_URL`, `READONLY_DATABASE_URL` | api | after A6; migrations run as the migrator role when set |
| `CLAMAV_HOST` (optional) | worker | after A7; without it only the magic-byte scanner runs |

`FIELD_ENCRYPTION_KEY`, the OTP/session/admin peppers, VAPID, R2 and Telnyx values already exist on dev and are preserved by the plan.

### A4. DNS and Turnstile for the clinic portal — Platform (Cloudflare)

1. In the `medidocs.app` zone add `CNAME staging-clinic` → the Railway domain of the `provider-web` service (shown after apply). Add the same domain in Railway with `railway domain`.
2. Turnstile → Add site: hostnames `staging-clinic.medidocs.app` (and later `clinic.medicinepassport.app`), managed mode. Copy the **site key** into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on provider-web and the **secret** into `TURNSTILE_SECRET_KEY` if a separate secret is wanted (the api accepts one secret today).
3. Add the clinic hostname to the existing "api/admin no-cache" rule so responses are never cached at the edge.

The Cloudflare token in `.dev-data/secrets.env` can do all three through the API if you prefer I do it once you say so.

### A5. Run the five backfills once, after the first deploy — Platform

They are idempotent and resumable. Run each as a one-off Railway job (`railway run --service api -- node ../cron/dist/jobs/<name>.js`) or from a laptop with the environment's `DATABASE_URL`, in this order:

```
backfill-provenance
backfill-health-events
backfill-observations
backfill-diagnostics
backfill-documents
```

Each prints a summary; a non-zero `skipped` count names rows that need a person. Rehearse on dev before production.

### A6. Database roles — Platform (SQL)

`infra/railway/README.md` has the SQL: a migrator role owning the schema, the runtime role limited to DML, a read-only role. Run it on each environment's Postgres, then set the two URLs from A3. Verify by trying `ALTER TABLE` as the runtime role: it must fail.

### A7. ClamAV daemon — Platform, optional

Add a Railway service from the `clamav/clamav:stable` image on the private network, then set `CLAMAV_HOST=clamav.railway.internal` on the worker. Until then uploads are checked by file signature only (executables, scripts and script-bearing PDFs are already refused).

### A8. Production check-suites gate — Platform, one command

```
node .railway/set-check-suites.mjs 984e456c-9890-4e7c-acc7-9b6baff46852 --apply
```

After this, production only deploys commits whose CI run is green. Do it before any merge to `foundation`.

### A9. Rotate what was exposed — Platform

Two Railway tokens were pasted into chat earlier in this project (`65a95032…`, `b6e51a9b…`); delete them in Railway → Account → Tokens. When you no longer need me to act, delete the four tokens in `.dev-data/secrets.env` at their sources (GitHub, Railway, Cloudflare, Google Cloud) and the file itself.

## Part B — reviews only a qualified person can do

### B1. Native review of Hindi, Telugu and Urdu — Review (H-19)

Roughly 900 V2 strings per language sit under `// DRAFT` headers in `packages/localization/src/dictionaries/{hi,te,ur}.ts`. A translation that changes clinical meaning is a safety defect, so no locale ships on a draft.

How: give a native-speaking clinician or pharmacist the English file and the draft side by side (I can export a CSV of key, English, draft on request). They correct in place. After the edits, regenerate the audio with the TTS key so the voice matches the text:

```
set -a; . .dev-data/secrets.env; set +a
cd apps/patient-web && node --import tsx scripts/generate-guidance-audio.mts
```

Only changed strings are regenerated (files are keyed by text hash).

### B2. Gate 4 clinical validation of new patient-facing copy — Review (OD-6)

Every V2 screen carries new English copy about medicines, tests and readings. The clinical lead reads it against docs_v2/10 (no interpretation of values, no dose proposals, causation never implied). Where: the `en.ts` dictionary and the `docs_v2/21` screen list. Outcome: a signed line in `docs_v2/10` per screen group.

### B3. Gate 1b terminology review — Review

`packages/terminology` maps 31 analytes and 19 concepts to LOINC/UCUM/SNOMED; the unmapped list is in the package README. A pharmacist or clinical informatician confirms the codes. Errors here become FHIR export errors, not patient harm, so it can follow B2.

### B4. Counsel: DPIA, retention, cross-border position — Review (OD-2, OD-7)

Send `docs_v2/validation/privacy-security/dpia-v1.md` and `retention-proposal-v1.md`. Counsel answers each retention row (agree / change / no basis) in the decision table and rules on the cross-border position. Engineering then builds the remaining retention crons (each a small job, listed as "to build" in the table).

### B5. DPO / grievance officer — Decision (OD-9)

Required before any external beta. Name a person, publish the contact in the privacy notice (`packages/localization` has the placeholder), record in `docs_v2/18`.

### B6. Breach tabletop — Review, 90 minutes

`docs_v2/validation/privacy-security/breach-tabletop-2026-09.md` is the scenario pack. Book the four people it names, run scenarios A and B at minimum, fill the log, and turn every "we do not know" into a ticket. Ticket 0.26 closes on the log entry.

### B7. Threat model sign-off — Review (Architecture Board)

`threat-model-v1.md`. Read, amend, record in the review log. Refresh again when the provider portal goes live to real clinics and when voice entry is enabled for pilot patients.

## Part C — external parties and contracts

### C1. ABDM sandbox credentials — External (NHA), ticket 0.8

1. Register at the ABDM sandbox portal (sandbox.abdm.gov.in) as a health information user and provider; needs the legal entity's details.
2. You receive a client id and secret. Set on the api and gateway: `ABDM_GATEWAY_ENV=sandbox`, `ABDM_GATEWAY_URL=http://abdm-gateway.railway.internal:4100`, and the client credentials the gateway README names; set `MOCK=false` on the gateway.
3. Run the sandbox conformance flows (ABHA link, discovery, care contexts, consent, data pull); the screens already exist. Failures come back as `AbdmTransaction` rows and gateway logs.
4. M8E: the NHA security assessment template, then production keys.

Until then everything ABDM runs against the mock gateway, which is what the tests use.

### C2. Licensed medicine catalogue — External (OD-3)

Candidates in India: CIMS/MIMS India, or a licensed dataset from a distributor. The contract must allow storing the mapped products. Once a file or API exists: implement `MedicationCatalogAdapter` in `packages/medication-terminology/src/catalog/` (the sample adapter is the template), run `catalogAdapterContract` against it, then the `import-medication-catalog` cron. Products the feed stops listing are deprecated, never deleted.

### C3. Interaction provider — External (OD-4)

Same shape as C2 for drug-drug interaction data; the safety engine (`packages/clinical-rules`) has the rule slot but no source. Blocked until a licence exists; do not substitute open data without the clinical lead's sign-off.

### C4. OCR / document-AI vendor — External (OD-11, OD-12)

Optional. Tesseract runs today. A vendor needs: a data-processing agreement, a no-training clause, and an adapter implementing `OcrProvider` or `DocumentAiProvider` in `apps/worker/src/lib/providers.ts` that passes `ocrProviderContract` / `documentAiProviderContract`. Select with `OCR_PROVIDER` / `DOCUMENT_AI_PROVIDER`. The DPIA §4 must be updated when one is contracted.

### C5. WhatsApp BSP and SMS DLT — External (OD-10)

WhatsApp opt-in answers "channel not available" until a business solution provider is contracted and the template messages approved; India SMS needs DLT registration of the sender id and templates. Telnyx voice OTP exists as the fallback. The notification code has the channel slots; only the transport is missing.

### C6. Pilot clinics and a lab partner — External (P11, P13)

The provider portal is built and tested against seeded organisations. Real validation needs one clinic, one pharmacy and one lab willing to use it; the seed script (`pnpm --filter @medpass/provider-web seed:dev-org`) creates their organisation and first member. A lab API adapter (P13 level 3) is written only once a named partner's format is known.

### C7. External penetration test — External, before V2.4 beta

Scope: api, patient-web, admin-web, provider-web, abdm-gateway on the staging hostnames. Give the tester `docs_v2/validation/privacy-security/threat-model-v1.md` and the seeded accounts. Findings go to `docs_v2/16 §3`.

### C8. Observability backend — Decision (OD-13)

Choose one (Grafana Cloud, Axiom, Datadog); set the OTLP endpoint variables in `packages/observability`; the seven SLI dashboards in docs_v2/14 are then built against it. Until then the daily operational-report cron is the monitoring.

### C9. Six more locales — External (translators)

ta/bn/mr/gu/kn/ml: professional translation of the same dictionary, native clinical review as in B1, fonts in the reflow tests, audio regeneration. The locale architecture supports them; nothing else is needed from engineering per language beyond the review loop.

## Part D — what I can still do for you once the above lands

- Apply the Railway plan and Cloudflare changes for A2–A4 with the tokens you provided, once you say which option.
- Export the CSVs for B1 and re-run the audio generation.
- Implement any adapter in C2–C4 within a day of the data or API being available.
- Build the remaining retention crons the moment counsel returns B4.
- Add the patient-facing "not relevant to me" action on safety findings (the API accepts it; only the button is missing) if the clinical lead agrees with the wording.

## Progress record

| Item | Owner | Done on | Note |
|---|---|---|---|
| | | | |
