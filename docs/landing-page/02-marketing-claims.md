# Landing Page — Session 1: Marketing Claims Ledger

**Date:** 2026-08-11 · **Status:** SEEDED — verification column reflects direct code inspection on this date ([00-current-state-audit.md](00-current-state-audit.md) §3 holds the underlying evidence); **no wording is approved yet** (wording approval happens at the SPEC Session 2/7 gates, business claims additionally gated by [01-decisions.md](01-decisions.md)).

Schema per [SPEC.md](SPEC.md) §44, plus an Evidence column. Rules: every safety, privacy, medical, or business-model sentence on the public site must trace to a row here; rows marked **DO NOT CLAIM** are prohibited on the site in any wording until their status changes; "Verified: Yes" means the capability was confirmed in code/production this session, not that any particular copy is cleared.

**Verified** values: `Yes` · `Yes (bounded)` — true only within the stated bounds, copy must respect them · `Blocked` · `No`.
**Review** values: the gate(s) that must clear before the claim ships: `Business (OD-LP-1)`, `Clinical (H-27 / docs/34)`, `Security (Stage 7 review)`, `Legal/Privacy (OD-LP-6)`, `Translation`, `N/A`.

---

## 1. Core positioning claims

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-001 | Medicine Passport is free for patients — not charged to create, maintain, access or share | Business decision | **Yes** — OD-LP-1 ruled 2026-08-11 (approved with boundaries) | Business/legal copy review of final wording | Pending (candidate copy in OD-LP-1) | No pricing/paywall exists in the product; promise scope bounded by OD-LP-1: core passport free, future *optional* capabilities not promised free forever |
| MKT-006 | ~~"Every feature will always be free forever"~~ or any unbounded permanent-free promise | — | **No** — prohibited framing per OD-LP-1 ruling | — | **PROHIBITED** | OD-LP-1: do not bind every possible future optional capability; the promise is "free for patients" scoped to the patient's own passport |
| MKT-002 | Works from any modern mobile browser — nothing to install | Product (PWA) | **Yes** | N/A | Pending | Live at `app.medidocs.app`; installation optional (A2HS education exists, never required); docs/00 §"Why a PWA first" |
| MKT-003 | The app supports English, Hindi, Telugu and Urdu | Localization | **Yes (bounded)** — UI strings complete in all four; hi/te/ur are DRAFT pending professional review; PDF/share-text render English-only | Translation — for non-English *site* copy and switcher entries; per OD-LP-4 addendum (2026-08-11) the *product*-language support statement may ship at English-only launch, visually distinct from site-language availability | Pending | `packages/localization/src/dictionaries/{en,hi,te,ur}.ts` (~718 keys, full parity); caveat: `visit-summary-text.ts`, PDF templates English-only. **Classification (Session 8 §0.D):** en/hi/te/ur are *technically implemented* in the app; non-English product/marketing language **quality** remains subject to professional review; **final non-English marketing recordings must not be produced or published** until that review clears. No translations are ever fabricated |
| MKT-004 | One patient-owned record of all your medicines | Medication passport | **Yes** | N/A | Pending | `apps/api/src/modules/medications`, list/detail UI, current + previous status, per-profile ownership |
| MKT-005 | In your language — read it, or listen to it | Read-aloud + guidance audio | **Yes** | Translation (spoken copy shares dictionary DRAFT status) | Pending | `lib/read-aloud.ts`, `components/ReadAloud.tsx`, 264 committed MP3s (66 entries × 4 locales) edge-cached in production |

## 2. Know — passport content claims (SPEC §13–14)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-010 | Each medicine records name, ingredient, strength, schedule, food instructions, prescribing doctor, your recorded reason, and status | Data model | **Yes** | N/A | Pending | Medication model + card UI; practitioner linkage (`PractitionersService`, "My doctors" screen 45); common-uses vs. personal-reason kept separate per docs/00 |
| MKT-011 | Add medicines by photographing a prescription — you confirm every extracted detail | Capture + OCR | **Yes (bounded)** — extraction proposes exactly 3 fields (brand name, frequency, food instruction); English printed text only; dose amounts are deliberately never auto-extracted | Clinical (H-27 wording) | Pending | `apps/worker/src/processors/{ocr,candidate-detection}.ts` (Tesseract.js), confirm/reject UI `app/add/scan/[documentId]` |
| MKT-012 | Add medicines by search or manual entry | Catalog + manual entry | **Yes (bounded)** — search works, but the catalog is a ~12-product dev seed; copy must not imply a comprehensive Indian medicine database | N/A (copy bound) | Pending | `catalog.controller.ts`, `app/add/page.tsx`; `packages/database/src/seed.ts`; docs/22 Stage 2 "Mocked"; OD-3 |
| MKT-013 | Keep prescription photos and reports attached to your record | Documents | **Yes** | N/A | Pending | Presigned R2 uploads with checksum/magic-byte verification (`documents.service.ts`); prescriptions/reports screens; R2 CORS fixed + live-verified (docs/22) |
| MKT-014 | Plain-language education about your medicines, where approved content exists | Approved-content education | **Yes (bounded)** — approved/maker-checker content pipeline exists; coverage follows the seeded catalog, so "where available" is mandatory phrasing | Clinical (H-27) | Pending | Education content workflow + translations (docs/22 Stage 8 entries); education e2e suite |

## 3. Remember — schedule and reminder claims (SPEC §15)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-020 | See today's doses on one timeline; record taken, skipped or snoozed | Timeline + dose events | **Yes** | N/A | Pending | `app/timeline`, `POST /doses/:id/events`, `scheduling.e2e-spec.ts` |
| MKT-021 | Optional browser reminders for due doses | Web push | **Yes** — the working delivery channels today are web push + in-app; copy must not enumerate SMS/WhatsApp | N/A | Pending | `VapidWebPushSender` (`packages/notifications`), SW push handler, quiet hours (`ReminderSettings.tsx`) |
| MKT-022 | See what you missed, and set important medicines to alert a caregiver | Missed-dose + escalation | **Yes** | Clinical (H-27 wording) | Pending | `reconcile-missed-doses.ts` (2h grace), `caregiver_escalation` with per-medicine critical bypass, `missed-dose-escalation.e2e-spec.ts` |
| MKT-023 | Know when a medicine is running low | Refill reminders | **Yes** | N/A | Pending | `generate-refill-reminders.ts`, `RefillReminderCard.tsx`, `refill-reminders.e2e-spec.ts` |
| MKT-024 | ~~"Never miss another medicine"~~ or any adherence guarantee | — | **No** — prohibited framing regardless of feature state | — | **PROHIBITED** | SPEC §15 names this explicitly; reminders are best-effort by nature |

## 4. Safety claims (SPEC §12 Story B, §21)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-030 | Can surface possible duplicate ingredients hidden behind different brand names | Safety rules | **Yes (bounded)** — real (exact + partial/combination), but detection depth follows the seeded catalog; wording must stay "possible … worth asking your doctor about" | Clinical (Stage 6 validation gate, H-27) | Pending | `safety-rules.ts` rules `duplicate-ingredient-exact/partial`; docs/22 Stage 6 "Requires clinical validation" |
| MKT-031 | Can flag possible same-type (therapeutic class) overlaps | Safety rules | **Yes (bounded)** — same catalog + validation bounds as MKT-030 | Clinical (Stage 6, H-27) | Pending | `safety-rules.ts` `duplicate-therapeutic-class` |
| MKT-032 | Can flag a medicine that matches an allergy you've recorded | Safety rules | **Yes (bounded)** — matches patient-recorded allergies by ingredient; not an allergy database | Clinical (Stage 6, H-27) | Pending | `safety-rules.ts` `allergy-ingredient-match`; `PatientAllergy` |
| MKT-033 | Drug–drug interaction checking | — | **No — DO NOT CLAIM** | Blocked on OD-3/OD-4 (licensed data + clinical validation) | **PROHIBITED until data source is live and validated** | `packages/clinical-rules` is an inert vocabulary scaffold; no interaction data or engine exists |
| MKT-034 | Food, alcohol, or condition-related medication warnings | — | **No — DO NOT CLAIM** | Blocked on OD-3/OD-4 | **PROHIBITED** | Same scaffold; category keys only, no rule code |
| MKT-035 | Any "safe"/"checked-safe" declaration about a medicine or combination | — | **No** — prohibited by product principles regardless of features | — | **PROHIBITED** | docs/02; SPEC §3.1; every finding routes to a professional |

## 5. Offline claims (SPEC §17)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-040 | Your saved medicine information stays viewable without internet | Offline cache | **Yes** | N/A | Pending | `packages/offline-sync` IndexedDB stores; Serwist shell; offline fallback route |
| MKT-041 | Record doses offline — they sync when you're back online | Mutation queue | **Yes** | N/A | Pending | `recordDoseEvent()` offline path, `POST /sync`, conflict review UI, `sync.e2e-spec.ts` |
| MKT-042 | Clear indication when you're offline or syncing | Status UI | **Yes** | N/A | Pending | `AppShell.tsx` offline/syncing/failed/pending states; "queued offline" on `DoseCard` |
| MKT-043 | Reminders/notifications while offline | — | **No — DO NOT CLAIM** — not implemented or verified in the current product | — | **PROHIBITED until proven** | Only notification path found is server-originated web push via the service worker; no local scheduling found this session |

## 6. Caregiving claims (SPEC §18)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-050 | Invite family to help — you choose exactly what they can see or do | Caregiver scopes | **Yes** | N/A | Pending | 10 scopes (`packages/domain` `CAREGIVER_SCOPES`), policy engine (`packages/authorization`), scope editing UI |
| MKT-051 | Manage a parent's or dependent's medicines from anywhere | Dependent profiles | **Yes** | N/A | Pending | Dependents + claim flow (`profile-claim.e2e-spec.ts`); caregiver access across profiles |
| MKT-052 | See every caregiver access; revoke access any time | Access log + revocation | **Yes** | N/A | Pending | `GET /caregivers/:id/accesses`, `DELETE /caregivers/:relationshipId`, access-log UI toggle |

## 7. Sharing claims (SPEC §19, §25)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-060 | Share your medicine list with a doctor via QR or a time-limited link | Share links + QR | **Yes** | Security (Stage 7 review gate) | Pending | `sharing.service.ts` (1h/24h/7d UI, 30d server cap, token stored as SHA-256 hash), `qrcode` in `share/new` |
| MKT-061 | The doctor doesn't need an account or app | Public share view | **Yes** | Security (Stage 7) | Pending | `GET /public/shares/:token` is `@Public()`; `/s/[token]` renders outside the app shell |
| MKT-062 | Download or hand over a PDF summary | PDF export | **Yes (bounded)** — English-only rendering today | Security (Stage 7) | Pending | `visit-summary-pdf.service.ts`, Puppeteer render in worker; regenerated per request, never stored |
| MKT-063 | Send a text summary through your own WhatsApp | WhatsApp share intent | **Yes (bounded)** — patient-initiated `wa.me` share of generated text from their own phone; English-only; **not** WhatsApp delivery by the platform | Security (Stage 7) | Pending | `visit-summary-text.ts`, `lib/sharing.ts` |
| MKT-064 | You can revoke a share at any time, and see when it was accessed | Revocation + access events | **Yes** | Security (Stage 7) | Pending | `revoke()`, `ShareAccessEvent` (records success, expired, revoked attempts), patient-visible access list |
| MKT-065 | WhatsApp/SMS messages sent by Medicine Passport (reminders, summaries) | — | **Blocked — DO NOT CLAIM** | — | **PROHIBITED** | SMS delivery Telnyx/DLT platform-blocked (docs/22 Stage 4); WhatsApp Business API nonexistent (OD-10) |

## 8. Trust & privacy claims (SPEC §21, §28)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-070 | Not a doctor — helps you understand and organize; decisions stay with your healthcare professional | Product boundaries | **Yes** (it's a boundary statement, and the product enforces it) | Clinical (wording), Legal/Privacy (OD-LP-6) | Pending | docs/02; every safety finding carries professional-referral wording |
| MKT-071 | Sharing is consent-driven, time-bounded, revocable, and logged | Consent + audit | **Yes** | Legal/Privacy (OD-LP-6), Security (Stage 7) | Pending | Consent cascade (`consents.controller.ts`), share mechanics above, audit chain |
| MKT-072 | No advertising in the patient experience; identifiable patient health information is never sold; no paywall on your own record | Business/privacy posture | **Yes** — principles established by OD-LP-1 ruling 2026-08-11 | Legal/Privacy (OD-LP-6) for published wording | Pending | Three principles now committed (OD-LP-1); copy must use this bounded form, not vaguer "data never sold" phrasing |
| MKT-073 | Export your data or delete your account | — | **No — DO NOT CLAIM** | — | **PROHIBITED until built** | No export or deletion endpoint/UI exists (full route sweep, audit §3); docs/18's flow is a plan. Also constrains `/privacy` drafting |
| MKT-074 | Specific regulatory-compliance assertions (e.g., "DPDP-compliant") | — | **No — DO NOT CLAIM** | Legal/Privacy (OD-LP-6) | **PROHIBITED until legal review rules** | docs/29 legal/DPDP review and DPO designation are open; describe practices, don't assert certifications |

## 9. Professional-page claims (SPEC §25)

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording | Evidence |
|---|---|---|---|---|---|---|
| MKT-080 | A structured, patient-confirmed medication view in seconds — no new software for the clinic | Share view | **Yes** | Security (Stage 7) | Pending | Same evidence as MKT-060/061; "patient-confirmed" is accurate (every OCR field human-confirmed, entries patient-owned) |
| MKT-081 | Clinical-outcome or efficiency statistics (time saved, errors reduced, adherence improved) | — | **No — DO NOT CLAIM** | — | **PROHIBITED** — no study exists; SPEC §25 bans unsupported statistics | No measurement has ever been made; also MKT-090 |

## 10. Cross-cutting prohibitions (apply to every section)

| Claim ID | Prohibition | Source |
|---|---|---|
| MKT-090 | No invented statistics, no fabricated testimonials, no real-patient stories without documented consent; persona vignettes must be presented as illustrative | SPEC §46 Session 15; truthful-engineering value (docs/00) |
| MKT-091 | No diagnosis/prescribing/substitution language; no implication of replacing professionals | docs/02; SPEC §3.1, §21 |
| MKT-092 | No medical-efficacy structured data (schema.org) implying unsupported claims | SPEC §31 |
| MKT-093 | No claim that the *website* handles patient health information — it never collects any | SPEC §1; enforced by architecture (static site, lead form has no health fields) |

---

## Claims that failed verification or await proof — summary for the Session 1 gate

**Failed / prohibited until the product changes:** MKT-033/034 (interactions, food/alcohol/condition — no data source), MKT-043 (offline reminders — not implemented or verified), MKT-065 (platform-sent SMS/WhatsApp — blocked/nonexistent), MKT-073 (export/deletion — not built), MKT-081 (efficiency statistics — never measured).

**True but need a gate to clear before shipping copy:** MKT-001/072 (business ruling made 2026-08-11; final wording needs business/legal copy review), MKT-030/031/032 + MKT-011/014/022 wording (clinical validation / H-27), MKT-060…064 + 080 (Stage 7 security review of sharing before production marketing exposure), MKT-003/005 (translation review for non-English copy), MKT-074 (legal review).

**True but bounded — copy must carry the bound:** MKT-003 (English-only PDF/share text), MKT-011 (3 fields, English print), MKT-012 (seeded catalog — no "comprehensive database" implication), MKT-014 ("where available"), MKT-021 (push + in-app only), MKT-062/063 (English-only; wa.me is patient-initiated).
