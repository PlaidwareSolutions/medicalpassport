# Landing Page — Session 2: Content Specification

**Date:** 2026-08-11 · **Status:** APPROVED at the Session 2 gate (2026-08-11), with the owner's five corrections applied in place (S2 neutral duplicate wording, S6 bounded read-aloud wording, S7 connectivity statement retained, S10 never-sold chip gating clarified, C4 absolutes removed) plus the product-vs-site language-distinction ruling — see [01-decisions.md](01-decisions.md) OD-LP-4 addendum and OD-LP-10. Copy remains a *skeleton*: every headline and line below is a **draft direction, not approved public copy**. Claim IDs reference [02-marketing-claims.md](02-marketing-claims.md); gate tags are defined in [03-information-architecture.md](03-information-architecture.md) §3. A gated element may not ship until its gate clears (**OD-LP-10** governs how gates meet the launch date).

Conventions: every section lists the eleven SPEC §46-Session-2 fields. "Audience thought" is what the visitor should be thinking as the section ends. All patient CTAs link `https://app.medidocs.app/?src=website`. Layout notes are structural only (wireframes are Session 3). Per [SPEC.md](SPEC.md) §32, every visual has a poster/static fallback and the section must work with zero media bytes.

---

# Homepage `/`

## S1 — Hero

- **Purpose:** explain the product in under one screen; convert or scroll.
- **Audience thought:** *"This is for people like me, it's free, and I don't have to install anything."*
- **Headline (DRAFT):** **"Your medicines. One place. In your language."** — the language reference is a *product*-language statement, permitted at English-only launch per the OD-LP-4 addendum.
- **Supporting copy (DRAFT):** "Keep track of what you take, why you take it, when to take it, and what to show your doctor — wherever you go." Brand lockup above: "Medicine Passport · by MediDocs" (OD-LP-3).
- **CTA:** primary **"Create my free Medicine Passport"**; secondary "See how it works" → `#s2-problem`. Trust chips: "Free for all patients" · "No app to install" · "App languages: English · हिंदी · తెలుగు · اردو". *(The "App languages:" prefix keeps product-language support **visually distinct** from the site language switcher, which lists only review-passed public locales — OD-LP-4 addendum.)*
- **Visual:** storyboard `01-hero` — 12–15s muted montage (passport list → capture/review → timeline → listen tap → QR share), poster = passport-list screenshot. No music.
- **Product evidence:** live app at `app.medidocs.app`; montage flows all use shipped screens.
- **Claim IDs:** MKT-001 (chip — wording GATED-BUSINESS/LEGAL), MKT-002, MKT-003 (product-language support statement — permitted at English-only launch, OD-LP-4 addendum), MKT-004, MKT-005 (listen beat in montage).
- **Mobile:** full-viewport stack — lockup, H1, support line, chips (wrapping row), CTA, secondary link; video as background-poster panel below the fold line, not behind text.
- **Desktop:** two columns — copy + chips + CTA left; phone-framed montage right with a **QR code** beside the CTA ("Scan to open on your phone").
- **Accessibility:** H1 is the page's only `<h1>`; montage has `aria-hidden` decorative treatment *plus* an adjacent text list of the five beats (no video-only information, SPEC §41); chips are a `<ul>`; reduced-motion/Save-Data ⇒ poster only.

## S2 — The problem (three stories)

- **Purpose:** recognition before software; make the visitor see their own family.
- **Audience thought:** *"That's us. That's my mother. That's me at the pharmacy."*
- **Headline (DRAFT):** **"Sound familiar?"**
- **Supporting copy (DRAFT), three story cards:**
  - **A — "Which medicines are you taking?"** "When every doctor has a different piece of your story, even a simple question becomes difficult. Strips in a drawer, prescriptions in a folder, photos on a phone — and a doctor waiting for an answer."
  - **B — Two names, one ingredient.** "Doctor A prescribes one brand. Doctor B prescribes another. Two different brand names may contain the same ingredient — and there's no easy way for a family to tell." *(Session 2 gate correction: neutral wording — never imply intent or guaranteed duplication.)* *Product tie-in sentence (GATED-CLINICAL, MKT-030):* "Medicine Passport can surface possible duplicates worth asking your doctor or pharmacist about." Until the gate clears, the story ends on the problem, calmly — never dramatized as an emergency (SPEC §12).
  - **C — Caring from another city.** "Your father's medicines are in Vijayawada. You're in Bengaluru. His memory of what changed at the last visit is the only record." Tie-in: profiles, permissions, revocable access (MKT-050/051/052 — ungated).
- **Closing thesis (DRAFT):** "Your medicine information should travel with you — not stay scattered across prescriptions, doctors, pharmacies and hospital files." Reveal: **"That's what Medicine Passport is for."**
- **CTA:** none (deliberate — the reveal hands off to S3).
- **Visual:** three illustrated vignette cards (illustration style is Session 4), scroll-revealed; **opt-in listen button per story** (Achernar narration, 4 locales when published).
- **Product evidence:** stories restate docs/00's documented problem and docs/01 personas (illustrative, not real patients — MKT-090).
- **Claim IDs:** MKT-090 (illustrative-vignette rule), MKT-030 (Story B tie-in, GATED-CLINICAL), MKT-050/051/052 (Story C).
- **Mobile:** vertical card stack, one story per viewport-ish; thesis as full-width statement panel.
- **Desktop:** three cards in a row (or staggered), thesis panel full-width beneath.
- **Accessibility:** each card an `<article>` with `<h3>`; narration buttons with visible playing state, pause/replay, transcript = the visible card text itself; scroll animations disabled under reduced motion.

## S3 — Product reveal

- **Purpose:** show the actual thing; convert the recognition into comprehension.
- **Audience thought:** *"Oh — it's a simple record. I could keep that."*
- **Headline (DRAFT):** **"One medicine record that belongs to the patient."**
- **Supporting copy (DRAFT):** "Every medicine, with the details that matter: name, ingredient, strength, when and how to take it, which doctor prescribed it, and why — in plain words. You own it. It goes where you go."
- **CTA:** repeat primary — "Create my free Medicine Passport".
- **Visual:** large annotated screenshot (static, not video): a passport medicine card with 5–6 field callouts.
- **Product evidence:** medication model + card UI; practitioner linkage; recorded-reason field kept separate from general uses.
- **Claim IDs:** MKT-004, MKT-010.
- **Mobile:** screenshot first, callouts as a caption list beneath (no floating annotations at small widths).
- **Desktop:** screenshot right, callout list left, CTA under copy.
- **Accessibility:** callouts are real text (`<dl>`), never baked into the image; screenshot `alt` describes the card's content class, not pixel detail.

## S4 — Know

- **Purpose:** demonstrate how medicines get *into* the passport and what you learn about them.
- **Audience thought:** *"I don't have to type everything — and I check what it read."*
- **Headline (DRAFT):** **"Know what you're taking."**
- **Supporting copy (DRAFT):** "Add medicines your way: photograph a prescription and confirm what Medicine Passport reads — you check every detail before it's saved *(bounded: extraction suggests the medicine name, frequency and food instruction from clearly printed text; you fill in the rest — copy must reflect this modesty, MKT-011)* — or find your medicine by search, or enter it yourself. Where approved information is available, see what a medicine is commonly used for, and how to take it, in plain language." Never implies a comprehensive medicine database (MKT-012 bound).
- **CTA:** none (mid-story).
- **Visual:** storyboard `02-add-medicine` — 8–12s: prescription photo → review extraction → confirm → medicine appears. Seeded fictional data only.
- **Product evidence:** presigned capture upload, Tesseract 3-field candidates, per-field confirm/reject UI, catalog search, manual entry (audit §3).
- **Claim IDs:** MKT-010, MKT-011 (bounded), MKT-012 (bounded), MKT-013, MKT-014 ("where available", GATED-CLINICAL wording).
- **Mobile:** copy, then video/poster, then a three-item "Photo · Search · Type it in" row.
- **Desktop:** video left, copy right (alternating sides through S4–S9).
- **Accessibility:** captions on the clip narrating each step; the three-way add row is a list; clip supplements — the copy states everything the video shows.

## S5 — Remember

- **Purpose:** the daily-use value: today's doses, visible and recordable.
- **Audience thought:** *"This is the part my family actually needs every day."*
- **Headline (DRAFT):** **"Know what comes next."**
- **Supporting copy (DRAFT):** "See today's medicines on one timeline. Mark doses taken, skipped or snoozed. Turn on browser reminders if you want them. See what was missed, know when a medicine is running low — and for important medicines, let a family member know if a dose stays missed *(escalation sentence GATED-CLINICAL wording, MKT-022)*." **Never** "never miss another medicine" or any adherence guarantee (MKT-024 prohibited); preferred framing per SPEC §15: "helps keep today's medicines visible and organized."
- **CTA:** none.
- **Visual:** storyboard `03-today-schedule` — timeline scroll, a dose marked taken, a refill chip visible.
- **Product evidence:** timeline + dose events, web push w/ quiet hours, refill reminders, missed-dose reconciliation + caregiver escalation (audit §3). Channels stated = browser reminders + in-app only (MKT-021 bound; **no SMS/WhatsApp mention** — MKT-065).
- **Claim IDs:** MKT-020, MKT-021 (bounded), MKT-022 (GATED-CLINICAL), MKT-023, MKT-024 (prohibition observed).
- **Mobile:** copy → clip/poster → three fact chips ("Today's timeline" · "Optional reminders" · "Refill awareness").
- **Desktop:** clip right, copy left.
- **Accessibility:** clip captioned; reminder claim phrased as optional ("if you want them") — consent-respecting tone matches the product's actual opt-in.

## S6 — Accessible by design

- **Purpose:** the differentiator: language, listening, and low-end-device respect. A major selling section (SPEC §16).
- **Audience thought:** *"My mother could actually use this herself."*
- **Headline (DRAFT):** **"Healthcare information shouldn't require perfect English, perfect eyesight or a new phone."** Sub-head: **"Read it — or listen to it."**
- **Supporting copy (DRAFT):** "Medicine Passport speaks English, हिंदी, తెలుగు and اردو — including right-to-left Urdu *(product-language support statement, permitted at English-only launch per the OD-LP-4 addendum; MKT-003)*. Guidance throughout the app can be read aloud at the tap of a listen button *(Session 2 gate correction: bounded wording matching the verified TTS capability — no "everywhere" absolutes; MKT-005)*. Big text, big buttons, simple screens — built for real phones on real networks, not showroom devices."
- **CTA:** none.
- **Visual:** storyboard `04-listen-language` — same screen cycling en→hi→te→ur (Urdu visibly RTL), then a listen-button tap with the playing state. Optionally an on-page opt-in audio sample ("Hear it in हिंदी").
- **Product evidence:** 4 dictionaries at parity, `direction()` RTL, read-aloud engine, 264 guidance MP3s live (audit §3.7).
- **Claim IDs:** MKT-003 (product-language support statement — permitted, OD-LP-4 addendum), MKT-005 (bounded read-aloud wording).
- **Mobile:** four mini-screens as a swipeable/scrolling strip; copy above.
- **Desktop:** four phone frames side by side; listen demo beneath.
- **Accessibility:** this section *is* the accessibility pitch — it must itself be exemplary: script samples have correct `lang` attributes; audio strictly opt-in with transcript; the four screens carry text alternatives naming each language.

## S7 — Works when connectivity doesn't

- **Purpose:** reliability honesty for prepaid-data reality; also a quiet trust move.
- **Audience thought:** *"It won't abandon me in the lift, in the village, on the train."*
- **Headline (DRAFT):** **"Your medicine record shouldn't disappear when the network does."**
- **Supporting copy (DRAFT):** "Your saved medicines stay viewable without internet. Record doses offline — they sync when you're back. You always see whether you're offline, syncing, or up to date. **Reminders need a connection**, so they may wait until you're back online *(mandatory honest bound — MKT-043)*."
- **CTA:** none.
- **Visual:** storyboard `07-offline` — airplane mode on → passport still there → dose recorded "queued offline" → reconnect → synced state.
- **Product evidence:** IndexedDB caches, mutation queue + `/sync`, status indicators (audit §3.2).
- **Claim IDs:** MKT-040, MKT-041, MKT-042; MKT-043 honored as an explicit stated limit, not silence.
- **Mobile/Desktop:** copy + clip, standard alternating layout.
- **Accessibility:** the offline/online state changes in the clip are captioned in words; the honest-bound sentence is body text, not fine print.

## S8 — Caregiving

- **Purpose:** the family story; second conversion moment.
- **Audience thought:** *"I can help Amma without taking her phone away — or her dignity."*
- **Headline (DRAFT):** **"Help your parents without taking control away from them."**
- **Supporting copy (DRAFT):** "Invite family to help — and choose exactly what each person can see or do. Manage a parent's or dependent's medicines from anywhere. Every caregiver access is visible to the patient, and access can be revoked at any time. Help that is granted, bounded, visible — and revocable."
- **CTA:** variant — **"Create a Medicine Passport for my family"** (same link/`src`).
- **Visual:** storyboard `05-caregiver` — caregiver invitation, permission picker, patient's access log.
- **Product evidence:** 10 scopes, invitations w/ expiry, dependent profiles + claim flow, patient-visible access log (audit §3.6).
- **Claim IDs:** MKT-050, MKT-051, MKT-052.
- **Mobile:** copy → clip → CTA.
- **Desktop:** clip left, copy + CTA right.
- **Accessibility:** permission-picker UI shown in the clip is also enumerated in text ("see medicines · manage reminders · full management …" examples).

## S9 — Share with a doctor · **[ENTIRE SECTION GATED-SECURITY — Stage 7 review]**

- **Purpose:** the appointment payoff; feeds `/for-clinics/`.
- **Audience thought:** *"Next appointment, I just show this."*
- **Headline (DRAFT):** **"Bring your medicine list to the appointment — not a folder of paper."**
- **Supporting copy (DRAFT):** "Share a summary with a QR code or a link that expires when you say so. The doctor needs no account and no app. Prefer paper? Download a PDF. You can revoke a share at any time — and see exactly when it was opened." Optional line (GATED-SECURITY, bounded MKT-063): "Or send the summary through your own WhatsApp." **Never** "MediDocs sends WhatsApp messages" (MKT-065).
- **CTA:** none (S10 follows with the emotional peak).
- **Visual:** storyboard `06-share-doctor` — share → QR fills screen → (cut) summary opens on another device → revoke tap.
- **Product evidence:** share links (server-capped expiry, hashed tokens), QR, Puppeteer PDF, `@Public()` share view, revocation, `ShareAccessEvent` log (audit §3.1).
- **Claim IDs:** MKT-060, MKT-061, MKT-062 (bounded: English-only PDF today), MKT-063 (bounded), MKT-064 — **all GATED-SECURITY**.
- **Mobile:** copy → clip → four fact chips (QR · expires · no doctor account · revocable).
- **Desktop:** clip right, copy left.
- **Accessibility:** QR always accompanied by the equivalent-link statement; revocation/expiry facts in text.
- **Launch note (OD-LP-10 ruling):** Stage 7 security review is a **hard launch gate for the sharing story** — until it clears, this section is disabled/omitted entirely (never softened), with the architecture preserved so it can be enabled after approval.

## S10 — Free for all patients

- **Purpose:** the promise, stated plainly, with the credibility of a funding answer. Visually interrupts the page (SPEC §20).
- **Audience thought:** *"Free — and I can see why, so I believe it."*
- **Headline (DRAFT):** **"Medicine Passport is free for all patients."**
- **Supporting copy (DRAFT — OD-LP-1's candidate wording, final text GATED-BUSINESS/LEGAL):** "Your medicine information belongs to you. Medicine Passport is free for all patients to create, maintain and share. We plan to sustain MediDocs through services and partnerships with healthcare organizations — not by charging patients for access to their own medicine information." Principle chips: "No advertising in the patient experience" · "Identifiable health information is never sold" · "No paywall on your own record" (MKT-072 bounded form). *(Session 2 gate ruling: the "never sold" chip is **intended policy wording and stays GATED-BUSINESS/LEGAL** — it does not become approved public copy until that permanent commitment receives business/legal approval.)* **Never** "everything free forever" (MKT-006 prohibited).
- **CTA:** repeat primary.
- **Visual:** none/typographic — a full-bleed color-block statement panel (design in Session 4). Deliberately the *least* decorated section.
- **Product evidence:** business ruling OD-LP-1 (2026-08-11); no paywall exists in the product.
- **Claim IDs:** MKT-001, MKT-072 (both wording-gated), MKT-006 (prohibition observed).
- **Mobile/Desktop:** single centered statement panel; chips wrap beneath; CTA below.
- **Accessibility:** color-block contrast at AA against both text and chips; chips are a list.

## S11 — Trust

- **Purpose:** boundaries as value; pre-empt the "is this snake oil / is this an AI doctor" objection.
- **Audience thought:** *"They're honest about what it doesn't do. I trust the rest more."*
- **Headline (DRAFT):** **"Built to help you understand your medicines — not to replace your doctor."**
- **Supporting copy (DRAFT), two columns:**
  - **Medicine Passport does:** keep your medicine information organized and yours · explain medicines in plain language where approved information is available · point out things worth asking your doctor about *(GATED-CLINICAL, MKT-030/031/032)* · let you share on your terms, and see every access *(GATED-SECURITY, MKT-071)*.
  - **Medicine Passport does not:** diagnose · prescribe · tell you to start or stop a medicine · substitute one medicine for another · declare any medicine "safe" · replace doctors or pharmacists (MKT-070/091 — always claimable).
  - **Deliberate omissions:** no export/deletion promise (MKT-073 not built), no compliance assertions (MKT-074), no "your data is encrypted with military-grade…" theatrics.
- **CTA:** none; quiet links to `/privacy/` and `/terms/` (once real).
- **Visual:** none — typographic two-column truth table.
- **Product evidence:** docs/02 boundaries; consent cascade; finding wording routes to professionals.
- **Claim IDs:** MKT-070, MKT-071 (GATED-SECURITY), MKT-090/091/092/093 (prohibitions observed), MKT-073/074 (observed by omission).
- **Mobile:** "does" list then "does not" list, stacked.
- **Desktop:** side-by-side columns.
- **Accessibility:** both lists proper `<ul>` under `<h3>`s; "does not" items are complete sentences (screen-reader flow), not bare fragments.

## S12 — Healthcare professional bridge

- **Purpose:** route professionals out of the patient story without diluting it (SPEC §22: short).
- **Audience thought (professional):** *"There's a page for me."*
- **Headline (DRAFT):** **"Are you a doctor, pharmacist or clinic?"**
- **Supporting copy (DRAFT):** "See how patient-held Medicine Passports can make medication information easier to review at the point of care."
- **CTA:** "Learn about Medicine Passport for healthcare professionals" → `/for-clinics/`.
- **Visual:** none (one-band section).
- **Product evidence / Claim IDs:** MKT-080 tease (full treatment on C-pages). No lead form here (SPEC §22).
- **Mobile/Desktop:** single centered band, visually distinct (cooler tone) from the patient story.
- **Accessibility:** the link names its destination explicitly.

## S13 — FAQ

- **Purpose:** objection handling in the visitor's own words; also the `FAQPage` structured-data source.
- **Audience thought:** *"Every doubt I had has a straight answer."*
- **Headline (DRAFT):** **"Questions families actually ask."**
- **Q&A skeletons (DRAFT; answers are directions, not final copy):**
  1. **Is Medicine Passport really free?** → OD-LP-1 approved framing (MKT-001, wording-gated).
  2. **Do I need to install an app?** → No; works in the browser; optional add-to-home-screen (MKT-002).
  3. **Which languages are supported?** → answered in two distinct statements (OD-LP-4 addendum): the *app* supports English, Hindi, Telugu and Urdu (MKT-003, permitted); this *website* is available in the locales published after translation review.
  4. **Can my family help manage my medicines?** → invitations, chosen permissions, visible access, revocation (MKT-050/051/052).
  5. **Does my doctor need an account?** → No — QR or link, no app, no account (MKT-061, GATED-SECURITY).
  6. **Can it tell me whether two medicines are safe together?** → **Honest negative, carefully worded:** "No. Medicine Passport does not check drug interactions and never declares combinations safe. It can point out possible duplicate ingredients or overlaps worth asking your doctor or pharmacist about *(that sentence GATED-CLINICAL, MKT-030/031)*." (MKT-033/035 prohibitions honored by the explicit "no".)
  7. **Does it replace medical advice?** → No, plainly (MKT-070).
  8. **What happens if I have no internet?** → view + record offline, sync later; **reminders need a connection** (MKT-040/041, MKT-043 honest bound).
  9. **Who can see my information?** → only people you've shared with or invited; every access visible (MKT-052/071 — second clause GATED-SECURITY).
  10. **Can I stop sharing with someone?** → yes, any time — revoke a share link or a caregiver (MKT-064 GATED-SECURITY, MKT-052).
- **CTA:** none.
- **Visual:** none. All answers **permanently visible** (no accordions) — mirroring the app's own help-FAQ lesson that disclosure interactions are themselves a hurdle for the target user (docs/22).
- **Claim IDs:** as per question above.
- **Mobile/Desktop:** single column of Q&A pairs; desktop max-width for line length.
- **Accessibility:** questions are `<h3>`s; answers plain paragraphs; no toggle state to manage.

## S14 — Final CTA

- **Purpose:** the close, repeating the emotional proposition.
- **Audience thought:** *"Alright — now."*
- **Headline (DRAFT):** **"Take your medicine information with you."** Sub: "Start your Medicine Passport today."
- **CTA:** **"Create my free Medicine Passport"**; desktop shows the QR beside it. No lead form for patients, ever (SPEC §24).
- **Visual:** none/typographic band above the footer.
- **Product evidence / Claim IDs:** MKT-001 (chip if repeated, wording-gated), MKT-002.
- **Mobile:** full-width button; thumb-reachable.
- **Desktop:** centered block, QR right.
- **Accessibility:** QR paired with the same-destination text link; button text names the action, not "click here".

---

# `/for-clinics/`

*(English-only in v1 — [03-information-architecture.md](03-information-architecture.md) §1. Sections C1 and C3–C5 are GATED-SECURITY as marked; C7's workflow is OD-LP-2.)*

## C1 — Hero · [GATED-SECURITY]

- **Purpose:** reframe the same product for the professional's 30-second reality.
- **Audience thought:** *"A patient could actually hand me something usable."*
- **Headline (DRAFT):** **"A clearer medication picture, brought by the patient."**
- **Supporting copy (DRAFT):** "Medicine Passport is a free, patient-held medication record. When a patient shares it, you see a structured, patient-confirmed list — in seconds, with nothing to install."
- **CTA:** "Bring Medicine Passport to your patients" → `#c7-lead`. Secondary: "See what patients use" → `/`.
- **Visual:** static screenshot of the shared-summary view (clinician-side).
- **Product evidence:** public share view; patient-confirmation model (every OCR field human-confirmed).
- **Claim IDs:** MKT-080 (GATED-SECURITY), MKT-001 ("free" mention, wording-gated).
- **Mobile/Desktop:** as S1 pattern, no QR.
- **Accessibility:** as S1; screenshot content mirrored in text.

## C2 — The reconciliation problem

- **Purpose:** name the professional pain without invented numbers.
- **Audience thought:** *"Yes — this is every third consultation."*
- **Headline (DRAFT):** **"'What medicines are you taking?' shouldn't be the hardest question of the visit."**
- **Supporting copy (DRAFT):** "Medication information arrives as loose prescriptions, discharge summaries, photographs and memory. Reconciling it takes time the consultation doesn't have." **No efficiency/outcome statistics of any kind** (MKT-081 prohibited).
- **CTA/Visual:** none/light illustration.
- **Claim IDs:** MKT-081 (prohibition observed), MKT-090.
- **Layout/Accessibility:** single text band; standard.

## C3 — What the professional sees · [GATED-SECURITY]

- **Purpose:** concrete proof — the actual shared summary.
- **Audience thought:** *"Structured, ingredient-level, and I can see when it was confirmed."*
- **Headline (DRAFT):** **"A structured list, not a shoebox of paper."**
- **Supporting copy (DRAFT):** "Current medicines with ingredients, strengths and schedules; recorded allergies; recent changes — as the patient confirmed them. Live at the moment of access, not a stale export. A PDF when paper is easier *(English-only today — bound, MKT-062)*."
- **CTA:** none.
- **Visual:** storyboard `06-share-doctor` reused, clinician cut; or annotated screenshot.
- **Product evidence:** share aggregation is live-at-access (audit §3.1); PDF regenerated per request.
- **Claim IDs:** MKT-060/062 (GATED-SECURITY, bounded), MKT-080.
- **Layout/Accessibility:** standard alternating; annotations as text.

## C4 — No doctor account required · [GATED-SECURITY]

- **Purpose:** kill the adoption-cost objection in one band — without absolutes about the professional's workflow *(Session 2 gate correction: "No workflow change" removed as too absolute)*.
- **Headline (DRAFT):** **"No doctor account. No software to install."**
- **Supporting copy (DRAFT):** demonstrate the actual workflow as two plain steps: "1. Your patient presents a QR code or a link. 2. You open their patient-shared summary." Nothing stronger is claimed.
- **Visual:** two-step inline diagram (QR/link → summary open), text-first.
- **Claim IDs:** MKT-061 (GATED-SECURITY).
- **Layout/Accessibility:** one-band statement + two-step list; steps as an `<ol>`.

## C5 — Patient-controlled access · [GATED-SECURITY]

- **Purpose:** position patient control as the professional's safeguard too.
- **Headline (DRAFT):** **"Access the patient grants — and can take away."**
- **Supporting copy (DRAFT):** "Shares are consented, time-limited and revocable. Every access is logged and visible to the patient. You see what they chose to share — nothing more, nothing silently retained by you."
- **Claim IDs:** MKT-064, MKT-071 (both GATED-SECURITY).
- **Layout/Accessibility:** four fact chips + a paragraph; chips as list.

## C6 — Why clinics might care

- **Purpose:** the value proposition in non-outcome terms only.
- **Headline (DRAFT):** **"Better inputs to the decisions you already make."**
- **Supporting copy (DRAFT), four tiles:** easier access to patient-supplied medication information · a structured, ingredient-level view · fewer handwritten pages to interpret · patient-controlled information exchange. **No clinical-outcome claims** unless validated (per SPEC §25).
- **Claim IDs:** MKT-080 family; MKT-081 (observed).
- **Layout/Accessibility:** 2×2 tiles desktop, stacked mobile; tiles as list items.

## C7 — Lead CTA + form (`#c7-lead`)

- **Purpose:** the page's conversion event (the submission itself is the metric — OD-LP-8).
- **Audience thought:** *"Low commitment; I'll hear back."*
- **Headline (DRAFT):** **"Bring Medicine Passport to your patients."**
- **Supporting copy (DRAFT):** "Tell us who you are — we'll help you introduce Medicine Passport at your clinic or pharmacy." Confirmation-state copy depends on **OD-LP-2** (response expectation unresolved — placeholder: "Thank you — we'll be in touch.").
- **Form (provisional fields endorsed under OD-LP-2, built in Session 10):** Name* · Organization/Clinic* · Role* · City* · Email OR Phone* (at least one) · Message (optional) · Consent to be contacted*. **No patient/health fields of any kind** (MKT-093). Turnstile + rate limiting server-side (Session 10).
- **Claim IDs:** MKT-093; workflow OD-LP-2 (OPEN).
- **Mobile:** single-column form, labels above fields.
- **Desktop:** copy left, form right.
- **Accessibility:** every field labeled + described; error text in words adjacent to fields; consent checkbox unticked by default with plain-language purpose; submit button names the action.

---

## Gated-claim usage summary (for the Session 2 gate)

| Gate | Elements using it |
|---|---|
| **GATED-SECURITY** (Stage 7) | S9 entire section; S11 "share on your terms" line; S13 Q5/Q9(second clause)/Q10; C1, C3, C4, C5 |
| **GATED-CLINICAL** (Stage 6 / H-27) | S2 Story B tie-in; S4 "where available" education wording; S5 escalation sentence; S11 "worth asking about" line; S13 Q6 capability sentence |
| **GATED-TRANSLATION** | Non-English *site* copy and language-switcher entries only. Per the OD-LP-4 addendum, the *product*-language support statements (S1 chip, S6, S13 Q3) may ship at English-only launch, kept visually distinct from site-language availability |
| **GATED-BUSINESS/LEGAL** | S1 free chip, S10 entire wording, S13 Q1 (OD-LP-1 final copy review); `/privacy/` `/terms/` (OD-LP-6) |
| **OPEN decisions touched** | C7 workflow + confirmation copy (OD-LP-2); launch composition of all gated elements (OD-LP-10) |

Prohibitions verified against every section: no interaction/food/alcohol claims (MKT-033/034), no platform-sent SMS/WhatsApp (MKT-065), no offline reminders (MKT-043 stated as a limit instead), no export/deletion claims (MKT-073), no comprehensive-database implication (MKT-012), no statistics/testimonials (MKT-081/090), no "safe" declarations (MKT-035), no adherence guarantees (MKT-024), no unbounded free-forever promise (MKT-006).
