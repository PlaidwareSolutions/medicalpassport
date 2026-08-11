# Stage 7 — Patient-Controlled Sharing Security Review

**Date:** 2026-08-12 · **Purpose:** determine whether the existing sharing capability is secure enough to clear the Stage-7 gate that has kept the professional marketing unit (S9 → S12 → `/for-clinics/` → lead path) disabled (OD-LP-10). Review of an existing capability against synthetic data only; no production data touched.

**Security objective:** a public share link exposes *exactly the information the patient consented to, only while the share is valid, and cannot reasonably be used to reach another patient's information.* The share token is treated as a bearer credential throughout.

---

## A. Architecture reviewed

| Concern | Location |
|---|---|
| Public access (no auth) | `apps/api/.../sharing.controller.ts` `GET /public/shares/:token` (+ `/pdf`) — `@Public()`, `@RateLimit(share_access 30/60s)` |
| Authenticated create/list/revoke/log | same controller: `POST /profiles/current/shares`, `GET /profiles/current/shares`, `GET /shares/:id/accesses`, `POST /shares/:id/revoke` — all through `ProfileAccessService.require(req, "share_records")` |
| Core logic | `sharing.service.ts` — create/list/accessLog/revoke/revokeAsAdmin/accessByToken |
| Payload builder | `visit-summary.service.ts` `build(profileId, sections)` — shared by authenticated doctor-visit mode and the public path; only `sections` differ |
| Token | `common/crypto.ts` `newOpaqueToken()` / `sha256Hex()` |
| Authorization policy | `packages/authorization/src/index.ts` `decideProfileAccess` + `SCOPE_GRANTS` |
| Models | `SharePackage`, `ShareLink` (`tokenHash`, `expiresAt`, `revokedAt`), `ShareAccessEvent` |
| Public frontend | `apps/patient-web/app/s/[token]/page.tsx` (client component, no `AppShell`), `components/VisitSummarySections.tsx` |
| PDF render | `apps/worker/.../visit-summary-html.ts` (Puppeteer) |
| Edge/headers | `apps/api/.../correlation.middleware.ts` (global `private, no-store`), `apps/patient-web/next.config.mjs` |

## B. Token security

- **Generation:** `randomBytes(32).toString("base64url")` — **256 bits** from Node's CSPRNG, ~43-char URL-safe string. Standard, not home-grown.
- **Search space:** 2²⁵⁶. Brute force is infeasible independent of rate limiting; the 30/60s edge+app limit is defense-in-depth, not the primary control.
- **Storage:** only `sha256Hex(token)` is persisted (`ShareLink.tokenHash`); the raw token is returned to the creator once and never stored. Lookup is by hash. **No raw bearer token at rest.** ✓

## C. Authorization

`share_records` is granted to the profile **owner/claimer** (actorRole `patient`) or a caregiver holding the `share_records` **or** `full_management` scope — nothing else. Create/list/revoke/accessLog all resolve the relationship per request, so caregiver revocation is immediate. Owner-scoped queries (`findFirst({ where: { id, sharePackage: { patientProfileId } } })`) gate revoke and accessLog. Admin can *only* revoke via the `incident_response` duty (`revokeAsAdmin`) — never create or view.

| Actor | Create | View (public) | Revoke | Access log |
|---|:--:|:--:|:--:|:--:|
| Patient owner | ✓ | ✓ (holds token) | ✓ | ✓ |
| Caregiver w/ `share_records` or `full_management` | ✓ | ✓ | ✓ | ✓ |
| Caregiver w/o that scope | ✗ 403 | ✓ only if given token | ✗ 403 | ✗ 403 |
| Other authenticated patient | ✗ 404 | — | ✗ 404 | ✗ 404 |
| Anonymous recipient | ✗ | ✓ (valid token only) | ✗ | ✗ |

Cross-patient revoke/log return **404** (not 403), so a non-owner cannot even confirm a share exists. Now covered by a regression test (§I).

## D. Public payload (data-minimization inventory)

Built live every access (never a frozen snapshot); `sections` read **verbatim**, deliberately not merged with `ALL_SECTIONS`, so a link created before a section existed never begins exposing it (regression-tested). Per-field verdict:

| Field group | Verdict |
|---|---|
| profile displayName / yearOfBirth / sex | Intentionally shared (doctor needs to know whose summary) |
| medications: name, ingredients, strength, instruction, prescriber, startDate | Required for a doctor-facing list |
| ~~medications: internal `id`~~ | **Removed this review (F2)** — internal DB id, unused by the recipient, unnecessary on an unauthenticated payload |
| allergies / conditions / recentChanges / concerns / glucose / checkups | Intentionally shared, bounded to a 90-day window + row caps |
| prescriptions / reports | **Metadata + transcribed values only** — no document ids, no download URLs, no storage handles (verified in code and by existing tests). Prescription/report images stay behind the authenticated download endpoint |
| internal IDs / audit rows / caregiver data / phone numbers / session data | Not present |

## E. Expiration / revocation

Both enforced **server-side** in `accessByToken`: `result = revokedAt ? "revoked" : expiresAt < now ? "expired" : "success"`; any non-success throws `404 "This link is no longer available"` after recording the attempt. Expiry capped at 30 days at creation. Revocation is immediate for new requests and API calls (an already-rendered recipient page holds a static copy of what it already fetched — inherent to any bearer link, and it cannot re-fetch). Verified live on staging and by tests.

## F. Cache / index / referrer

- **Cache:** API sets `private, no-store` globally (correlation middleware) and again on the public share + PDF responses; verified live (`cache-control: private, no-store`, and a bogus token is `404` with no-store). PHI never enters a shared/CDN cache.
- **Referrer:** token is in the URL **path**, and patient-web sends `Referrer-Policy: strict-origin-when-cross-origin`, which strips the path on cross-origin requests — so the token does **not** leak via `Referer`, including to the cross-origin PDF link on `api.medidocs.app`. The `/s/` page loads only same-origin subresources.
- **Indexing:** *(finding F1, fixed)* — see §H.

## G. Logging / audit

Every access attempt (success / expired / revoked) is recorded as a `ShareAccessEvent` (result + optional `sha256(ip)` — never raw IP) and, for the patient-visible log, as an audit row with `actorType: "share_visitor"`. `share.created` / `share.revoked` / `admin.share_revoked` are audited. The **raw token is never logged** — the route param is opaque and carries no PHI, and the service logs only the `ShareLink.id`. Access counts shown to the patient come from `_count.accessEvents`. Matches the "see every access" claim.

## H. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| **F1** | **MEDIUM** | The `/s/<token>` bearer page (and all of patient-web) sent **no `X-Robots-Tag` / `noindex`**. `robots.txt` is only a content-signals file that does not disallow crawling. A share URL, if ever discovered by a crawler, could be indexed — directly undermining share confidentiality, so gate-blocking until fixed. | **FIXED** |
| **F2** | LOW | Internal medication DB `id` exposed on the unauthenticated payload. Not exploitable (random id; all medication endpoints are auth+scope gated) but an unnecessary internal identifier on a public path. | **FIXED** |
| **F3** | INFORMATIONAL | No regression test asserting cross-patient IDOR on revoke/accessLog. The control was already correct; added a test to prevent regression. | **FIXED** |

Checked and **no finding**: token entropy, token-at-rest hashing, IDOR (owner-scoped, 404 not 403), server-side expiry/revocation, caregiver-scope correctness, no-store caching, generic failure semantics (unknown/malformed/expired/revoked all `404 "no longer available"`, never 500 or existence-revealing), XSS (React auto-escapes; the PDF HTML routes every patient string through an `esc()` helper covering `& < > " '` — verified exhaustively), QR (encodes only the public share URL, no PHI in the payload), CORS (fixed origin allowlist; the public endpoint needs no credentials and works for non-browser clients by design), CSRF (state-changing share ops require the authenticated session + `x-requested-with`), third-party requests on the share page (same-origin only).

**PDF revocation honesty:** a PDF already downloaded by a recipient is an independent file — revocation stops *new* access via the link but cannot erase a downloaded copy. Reflected in the claims wording (§K), not overstated.

## I. Fixes (files + regression tests)

- **F1** — `apps/patient-web/next.config.mjs`: added `X-Robots-Tag: noindex, nofollow` to the app-wide header block (the whole PWA is private/authenticated). **Deployed and live-verified (Session 10, 2026-08-12):** `staging-app.medidocs.app/s/<token>` returns `x-robots-tag: noindex, nofollow` + `cache-control: private, no-store`; app root also noindex; login renders, API green — no regression.
- **F2** — removed `id` from `currentMedications` in `apps/api/.../visit-summary.service.ts`, the `VisitSummaryDto` in `packages/api-client/src/index.ts` and `apps/worker/.../visit-summary-html.ts`, and switched the React key to index in `VisitSummarySections.tsx`. Regression: `sharing.e2e-spec.ts` now asserts every `currentMedications` row has `id === undefined`.
- **F3** — `sharing.e2e-spec.ts` new case: a second unrelated patient gets **404** on `POST /shares/:id/revoke` and `GET /shares/:id/accesses` for the victim's share, and the victim's share stays live.

*(Also included, unrelated to a finding: the Session 9B `lib/medications.ts` frequency-label display fix, already approved.)*

## J. Test results

- `sharing.e2e-spec.ts`: **19/19** (incl. new IDOR + payload-minimization).
- Full API suite: **304/304** (36 suites) — shared `VisitSummaryDto` change caused no regressions.
- patient-web: typecheck clean, unit **14/14**, production build OK.
- worker + api-client: typecheck clean.

## K. Marketing-claim reconciliation (Stage-7 rows)

Re-evaluated individually — a passing feature does not auto-approve wording:

| Claim | Verdict |
|---|---|
| Time-limited share link (QR or link) | **Supportable** — server-enforced expiry ≤ 30 days |
| Doctor needs **no account / no app** | **Supportable** — `@Public()` route, recipient page outside `AppShell` |
| Patient can **revoke** a share | **Supportable for future access** — precise wording only ("stop a share at any time" / "revoke a link"); must **not** imply a doctor's already-downloaded PDF can be remotely erased |
| **See every access** / access log | **Supportable** — every attempt recorded and patient-visible |
| Structured, ingredient-level, patient-confirmed list | **Supportable** — matches the payload |
| PDF download | **Supportable** — bound to the same token, expiry and revocation for *link* access; downloaded-copy caveat above |
| Share via own WhatsApp | Supportable as a *user-initiated* action (unchanged from prior sessions) — never "MediDocs sends WhatsApp" |

These become approved public copy only when S9/`/for-clinics/` are actually built (Session 10), each string checked against this table.

## L. OD-LP-2 — recorded

**OD-LP-2 — APPROVED WITH OPERATIONAL ROUTING CONFIGURABLE** (2026-08-12). Professional lead fields: Name*, Organization/Clinic*, Role*, City*, Email OR Phone* (≥1), Message (optional), Consent to be contacted*. The form **never** collects patient health information. Initial storage: existing Postgres. **No CRM vendor in V1.** The internal notification/follow-up recipient stays **configurable**, not hardcoded, until the operational owner is finalized. This does **not** authorize Session 10 implementation during this review.

---

## M. Gate result

All Stage-7 exit criteria (§16 of the brief) are met: 256-bit tokens, no IDOR, server-enforced expiry and revocation, correct create/revoke authorization, caregiver behavior matching explicit scopes, minimized payload, tokens absent from logs/analytics, share pages now noindex (F1), no-store on sensitive responses, referrer leakage controlled, no XSS in patient-controlled fields, audit matching the public claims, and **no unresolved CRITICAL/HIGH/MEDIUM finding** (the one MEDIUM is fixed).

# STAGE 7 RESULT: PASS

**A PASS unlocks — but does not perform — the following (Session 10, each still gated on its own approval):**
1. record the Stage-7 share clip (the manifest's `r7-share-doctor`, currently unscripted);
2. process/publish it via the established media pipeline;
3. enable S9 (homepage sharing section);
4. enable S12 (professional bridge);
5. build `/for-clinics/`;
6. implement the professional lead form + `POST /v1/public/leads` backend (OD-LP-2 fields).

The professional unit (`PROFESSIONAL_UNIT_ENABLED`) remains **OFF** and was not enabled in this session. OD-LP-10's addendum is updated to note Stage 7 has cleared.
