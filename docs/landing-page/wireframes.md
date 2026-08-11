# Landing Page — Session 3: Wireframes

**Date:** 2026-08-11 · **Status:** DRAFT for the Session 3 gate ("review page density and story flow") — text-level wireframes only; no components, no visual design, no code.
Sources: [03-information-architecture.md](03-information-architecture.md) (section maps), [04-content-spec.md](04-content-spec.md) (per-section content, as corrected at the Session 2 gate), [01-decisions.md](01-decisions.md) (OD-LP-10 split gating, OD-LP-4 addendum). *(This file is deliberately unnumbered: SPEC reserves 05/06/07 for the design system, launch claim audit, and post-launch report.)*

Reading the frames: boxes are structural regions, not visual design. `▶` = video/poster slot (always poster-capable, muted, `preload="none"` below fold), `[CTA]` = primary patient CTA "Create my free Medicine Passport" → `app.medidocs.app/?src=website`, `(( ))` = opt-in listen button, `⛔S7sec` / `⛔clin` = gated region (Stage 7 security / clinical) rendered only when its gate clears — each gated region is a self-contained block whose removal leaves clean seams (OD-LP-10: architecture preserved, sections disable cleanly).

---

## 1. Global chrome

### 1.1 Header

```text
MOBILE (sticky)                          DESKTOP (sticky)
┌────────────────────────────────┐      ┌──────────────────────────────────────────────────────┐
│ Medicine Passport      [EN ▾]  │      │ Medicine Passport   For doctors & clinics   Help     │
│ by MediDocs                    │      │ by MediDocs                        [EN ▾]  [CTA-btn] │
└────────────────────────────────┘      └──────────────────────────────────────────────────────┘
```

- **Language switcher `[EN ▾]`** lists **published site locales only** (OD-LP-4 addendum). At English-only launch it renders as a static "EN" chip (no dropdown of one); it becomes a menu when ≥2 locales are published. It is *not* where the four-language product message lives — that's S1's "App languages:" chip, a visually different element.
- **Sticky CTA rule:** the header CTA button appears only after the user scrolls past S1's own CTA (avoids a doubled CTA in the first viewport and 320px crowding). Mobile sticky shows a short label ("Start free"); desktop shows the full label.
- **Language suggestion banner** (SPEC §30) sits above the header, only when `navigator.language` matches a *published* locale ≠ current: one line, "हिंदी में देखें? [हाँ] [✕]", dismissible, choice persisted. Never a redirect. At English-only launch it never renders.

### 1.2 Footer (both pages)

```text
┌────────────────────────────────────────────┐
│  S14 FINAL CTA BAND (see §2)               │
├────────────────────────────────────────────┤
│  For doctors & clinics   Privacy   Terms   │
│  Contact: [⛔ OD-LP-7 — no address until    │
│            ownership resolved]             │
│  MediDocs · company line        [EN ▾]     │
└────────────────────────────────────────────┘
```

---

## 2. Homepage `/` — mobile-first flow (390px reference, checked at 320px)

Complete reading order, top to bottom. Approximate section weight in viewports (vh) guides proportion, not pixel truth.

```text
┌──────────────────────────────────┐
│ (lang banner — conditional)      │
│ HEADER (sticky, no CTA yet)      │
├──────────────────────────────────┤
│ S1 HERO                    ~100vh│
│  Medicine Passport · by MediDocs │
│  H1  Your medicines. One place.  │
│      In your language.           │
│  support line (2 lines)          │
│  [Free for patients]             │
│  [No app to install]             │
│  [App languages: EN·हिं·తె·اردو]  │  ← product-language chip (distinct
│  [ CTA  Create my free           │     from header switcher)
│         Medicine Passport ]      │
│  See how it works ↓  (#s2)       │
│  ┌─────────────┐                 │
│  │ ▶ 01-hero   │  portrait phone │
│  │  (poster)   │  ~55vh          │
│  └─────────────┘                 │
├──────────────────────────────────┤
│ S2 PROBLEM                ~160vh │
│  H2  Sound familiar?             │
│  ┌ Story A ────────────┐         │
│  │ illus. 16:9         │         │
│  │ h3 + 3-line copy    │         │
│  │ (( listen ))        │         │
│  └─────────────────────┘         │
│  ┌ Story B ────────────┐         │
│  │ …ends on problem;   │         │
│  │ tie-in line ⛔clin   │         │
│  └─────────────────────┘         │
│  ┌ Story C ────────────┐         │
│  ┌ THESIS PANEL (full-width) ┐   │
│  │ "…should travel with you" │   │
│  │ → That's what Medicine    │   │
│  │   Passport is for.        │   │
│  └───────────────────────────┘   │
├──────────────────────────────────┤
│ S3 PRODUCT REVEAL          ~90vh │
│  H2  One medicine record that    │
│      belongs to the patient.     │
│  ┌ annotated screenshot ┐        │
│  └──────────────────────┘        │
│  callout list (dl, 5–6 items)    │
│  [ CTA ]                         │
├──────────────────────────────────┤
│ S4 KNOW                    ~90vh │
│  H2 + bounded copy               │
│  ▶ 02-add-medicine (portrait)    │
│  Photo · Search · Type it in     │
├──────────────────────────────────┤
│ S5 REMEMBER                ~90vh │
│  H2 + copy (escalation ⛔clin)    │
│  ▶ 03-today-schedule             │
│  [Today's timeline][Optional     │
│   reminders][Refill awareness]   │
├──────────────────────────────────┤
│ S6 ACCESSIBLE              ~90vh │
│  H2 + bounded copy               │
│  ‹ en │ hi │ te │ ur ›  ←swipe   │
│  strip of 4 mini-screens (ur RTL)│
│  (( hear a sample — opt-in ))    │
├──────────────────────────────────┤
│ S7 OFFLINE                 ~80vh │
│  H2 + copy incl. "Reminders      │
│  need a connection." (body text) │
│  ▶ 07-offline                    │
├──────────────────────────────────┤
│ S8 CAREGIVING              ~90vh │
│  H2 + copy                       │
│  ▶ 05-caregiver                  │
│  [ CTA-variant  …for my family ] │
├──────────────────────────────────┤
│ S9 SHARE  ⛔S7sec (whole)   ~90vh │
│  H2 + copy                       │
│  ▶ 06-share-doctor               │
│  [QR][expires][no doctor         │
│   account][revocable]            │
├──────────────────────────────────┤
│ S10 FREE (statement panel) ~70vh │
│  ████ full-bleed color block ███ │
│  H2  Medicine Passport is free   │
│      for patients.               │
│  sustainability paragraph        │
│  [no ads][never sold ⛔biz/legal] │
│  [no paywall]                    │
│  [ CTA ]                         │
├──────────────────────────────────┤
│ S11 TRUST                  ~80vh │
│  H2 + DOES list (4)              │
│      DOES-NOT list (7)           │
│  privacy · terms links           │
├──────────────────────────────────┤
│ S12 PRO BRIDGE             ~30vh │
│  band: Are you a doctor,         │
│  pharmacist or clinic? → link    │
├──────────────────────────────────┤
│ S13 FAQ                   ~200vh │
│  H2 + 10 Q&A, all visible,       │
│  answers ≤3 lines each           │
├──────────────────────────────────┤
│ S14 FINAL CTA              ~40vh │
│  H2  Take your medicine          │
│      information with you.       │
│  [ CTA ]  (no QR on mobile)      │
├──────────────────────────────────┤
│ FOOTER                           │
└──────────────────────────────────┘
```

Total ≈ 12–14 viewports — long-form narrative territory. Density mitigations: S12 and S14 are thin bands; S13 answers capped at ~3 lines (content constraint for Session 7); every `▶` lazy-loads. **320px behavior:** chips wrap to two rows; S6 strip stays swipeable; S9/S5 chip rows wrap; nothing horizontal-scrolls except the deliberate S6 strip.

---

## 3. Homepage — desktop adaptation (1280px reference)

Desktop reuses four layout patterns rather than fourteen bespoke layouts:

**P1 — Hero split** (S1)

```text
┌───────────────────────────────────────────────────────────────┐
│  lockup                                    ┌───────────┐      │
│  H1 (3 lines max)                          │  phone    │      │
│  support line                              │  frame    │      │
│  [chip][chip][App languages: …]            │  ▶ 01-hero│      │
│  [ CTA ]   ┌─────────┐                     │           │      │
│  see how ↓ │ QR card │ "Scan to open       └───────────┘      │
│            └─────────┘  on your phone"            45%         │
│                 55%                                           │
└───────────────────────────────────────────────────────────────┘
```

**P2 — Alternating media row** (S4, S5, S7, S8, S9 ⛔S7sec; media side alternates R,L,R,L,R)

```text
┌───────────────────────────────────────────────────────────────┐
│  ┌──────────┐        H2                                       │
│  │ phone    │        copy (60% col, vertically centered)      │
│  │ frame ▶  │        [chip row / step row]                    │
│  │ ≤640px h │        (CTA-variant here in S8)                 │
│  └──────────┘                                                 │
└───────────────────────────────────────────────────────────────┘
```

**P3 — Statement panel** (S2 thesis, S10, S12, S14): full-bleed band, centered content, max-width 720px; S10 carries chips + CTA; S14 adds the QR beside the CTA.

**P4 — Text columns** (S2 stories: three cards in a row, stagger/stack below 1100px, listen button under each illustration; S3: callout `<dl>` left 40% / screenshot right 60%; S11: does/does-not side-by-side; S13: single centered column, max-width 720px).

---

## 4. `/for-clinics/` — mobile flow and desktop adaptation

```text
MOBILE                                   DESKTOP notes
┌──────────────────────────────────┐
│ HEADER (same chrome; CTA slot    │     P1 split: copy left,
│ points to #c7-lead on this page) │     clinician-view screenshot right.
├──────────────────────────────────┤
│ C1 HERO  ⛔S7sec           ~90vh │     Secondary link "See what
│  H1 A clearer medication         │     patients use" → /
│     picture, brought by the      │
│     patient.                     │
│  copy (3 lines)                  │
│  [ Bring Medicine Passport to    │
│    your patients ] → #c7-lead    │
│  ┌ screenshot: shared summary ┐  │
├──────────────────────────────────┤
│ C2 PROBLEM band            ~50vh │     P3 statement band.
│  H2 + copy, zero statistics      │
├──────────────────────────────────┤
│ C3 WHAT YOU SEE ⛔S7sec     ~90vh │     P2 media row (clinician cut
│  H2 + copy (live-at-access,      │     of 06-share-doctor).
│  PDF English-only bound)         │
│  ▶ 06-share-doctor (clin. cut)   │
├──────────────────────────────────┤
│ C4 NO DOCTOR ACCOUNT ⛔S7sec ~40vh│     P3 band + inline 2-step
│  H2 No doctor account. No        │     diagram, text-first.
│     software to install.         │
│  1. Patient presents QR/link     │
│  2. You open their patient-      │
│     shared summary               │
├──────────────────────────────────┤
│ C5 PATIENT-CONTROLLED ⛔S7sec~50vh│     Chips row + paragraph.
│  [consented][time-limited]       │
│  [revocable][access logged]      │
├──────────────────────────────────┤
│ C6 WHY CLINICS CARE        ~60vh │     2×2 tile grid desktop;
│  4 tiles, non-outcome claims,    │     stacked mobile.
│  stacked                         │
├──────────────────────────────────┤
│ C7 LEAD (#c7-lead)         ~90vh │     Copy left 40% / form right 60%.
│  H2 + copy                       │
│  form: Name* / Org* / Role* /    │
│  City* / Email OR Phone* /       │
│  Message / [ ] consent*          │
│  [ Submit ]  (OD-LP-2 workflow   │
│  pending — confirmation copy     │
│  placeholder)                    │
├──────────────────────────────────┤
│ FOOTER                           │
└──────────────────────────────────┘
```

### Pre-clearance variant (consequence of OD-LP-10 — see Issue 1)

Until Stage 7 security review clears, C1's share-view claims, C3, C4 and C5 cannot be public. The page would reduce to:

```text
C1' hero (generic: patient-held record, no share-view claims)
C2  problem band
C6  why clinics care (non-outcome tiles)
C7  lead form
```

— a lead-capture page without its proof. Structurally valid (clean seams), narratively thin.

---

## 5. Region annotation tables

### Homepage

| Region | Section ID | Intent | Content spec | Media | CTA | Gated | Mobile behavior | Desktop behavior |
|---|---|---|---|---|---|---|---|---|
| Lang banner | — | Suggest published locale | 03 §5 | none | — | Not gated (renders only when a reviewed locale exists) | 1-line, dismissible, above header | Same |
| Header | — | Orientation + switcher | 03 §2 | none | Sticky CTA after S1 scroll | Not gated | Lockup + EN chip | + quiet links, full CTA button |
| Hero | S1 | Explain in <1 screen; convert | 04 §S1 | ▶ 01-hero portrait, poster | Primary + "see how" | Free-chip wording ⛔biz/legal; language chip = permitted product statement | Stack: copy→chips→CTA→media | P1 split + QR card |
| Problem | S2 | Recognition via 3 stories | 04 §S2 | 3 illustrations + (( )) narration | none | Story B tie-in ⛔clin | Cards stacked, thesis panel | P4 3-across, stagger <1100px |
| Reveal | S3 | Show the record | 04 §S3 | static annotated screenshot | Primary | Not gated | Image→callout list→CTA | P4 dl-left / image-right |
| Know | S4 | How medicines get in | 04 §S4 | ▶ 02-add-medicine | none | Education wording ⛔clin (bounds in copy) | Copy→clip→3-way row | P2, media right |
| Remember | S5 | Daily timeline value | 04 §S5 | ▶ 03-today-schedule | none | Escalation sentence ⛔clin | Copy→clip→chips | P2, media left |
| Accessible | S6 | Language + listen + device respect | 04 §S6 | 4 mini-screens + opt-in audio | none | Product-language statement permitted; non-EN site copy ⛔translation | Swipe strip | 4 frames side-by-side |
| Offline | S7 | Reliability honesty | 04 §S7 | ▶ 07-offline | none | Not gated (honest bound mandatory) | Copy→clip | P2, media right |
| Caregiving | S8 | Family value | 04 §S8 | ▶ 05-caregiver | Variant CTA | Not gated | Copy→clip→CTA | P2, media left |
| Share | S9 | Appointment payoff | 04 §S9 | ▶ 06-share-doctor | none | **⛔S7sec — whole section** | Copy→clip→chips | P2, media right |
| Free | S10 | The promise + funding answer | 04 §S10 | none (typographic) | Primary | Wording ⛔biz/legal (never-sold chip explicitly) | Full-bleed panel | P3 |
| Trust | S11 | Boundaries as value | 04 §S11 | none | none | "worth asking"/"share on your terms" lines ⛔clin/⛔S7sec | Lists stacked | P4 two columns |
| Bridge | S12 | Route professionals out | 04 §S12 | none | Link to /for-clinics/ | Not gated (target page may be held — Issue 1) | Thin band | P3 |
| FAQ | S13 | Objection handling | 04 §S13 | none | none | Q1 ⛔biz/legal; Q5/Q9/Q10 ⛔S7sec; Q6 sentence ⛔clin | All answers visible, ≤3 lines | P4 centered column |
| Final CTA | S14 | Close | 04 §S14 | QR (desktop) | Primary | Chip wording ⛔biz/legal | Full-width button | P3 + QR |
| Footer | — | Legal/contact/switcher | 03 §2 | none | repeat links | Contact ⛔OD-LP-7; privacy/terms ⛔OD-LP-6 | Stacked | 3-column |

### `/for-clinics/`

| Region | Section ID | Intent | Content spec | Media | CTA | Gated | Mobile behavior | Desktop behavior |
|---|---|---|---|---|---|---|---|---|
| Hero | C1 | Professional reframe | 04 §C1 | screenshot | Anchor → #c7-lead | **⛔S7sec** (share-view claims) | Stack | P1 split |
| Problem | C2 | Name the pain, no stats | 04 §C2 | light illustration | none | Not gated (MKT-081 prohibition observed) | Band | P3 |
| What you see | C3 | Concrete proof | 04 §C3 | ▶ 06 clinician cut | none | **⛔S7sec** | Copy→clip | P2 |
| No account | C4 | Adoption cost ≈ zero | 04 §C4 | 2-step diagram | none | **⛔S7sec** | Band + `<ol>` | P3 + inline diagram |
| Patient control | C5 | Control as safeguard | 04 §C5 | none | none | **⛔S7sec** | Chips + para | Chips row |
| Why care | C6 | Non-outcome value | 04 §C6 | none | none | Not gated | Tiles stacked | 2×2 grid |
| Lead | C7 | Conversion event | 04 §C7 | none | Submit | Workflow OD-LP-2 (OPEN); no health fields ever | Single-col form | Copy 40% / form 60% |

---

## 6. Gated-region treatment (structural contract)

Every ⛔ region is a **self-contained block with clean seams**: removing it must leave no dangling transition, heading gap, or orphaned anchor. Verified seam-by-seam: S8→S10 reads correctly without S9 (caregiving CTA → free panel, which is a deliberate visual interrupt anyway); Story B ends calmly on the problem without its tie-in; S11's gated lines drop from lists without leaving stubs; FAQ questions 5/9(second clause)/10 drop whole; C-page pre-clearance variant in §4. Implementation direction (Session 5): gating is a per-section build-time flag, so enabling a cleared section is a content release, not a redesign — per OD-LP-10 "preserve the complete architecture."

Reduced-motion / Save-Data variants are structurally identical (posters replace `▶`, scroll-reveal off) — no layout depends on motion or video.

**404:** header + "This page doesn't exist." + primary CTA + link home. Nothing else.

---

## 7. Issues discovered during wireframing

1. **`/for-clinics/` is mostly inside the security gate.** ~~Needs the owner's pick.~~ **RULED at the Session 3 gate (2026-08-11):** the recommendation is adopted — the professional experience is **one gated release unit** (S9 → S12 → `/for-clinics/` → lead path) enabled only when Stage 7 clears; before clearance the homepage runs S11 → S13 on the clean seam, and **no public "coming soon" clinics page** is created unless explicitly requested. The §4 pre-clearance variant is retired. Recorded in [01-decisions.md](01-decisions.md) OD-LP-10 addendum.
2. **Single-locale switcher looks broken.** A dropdown containing only "EN" reads as a bug. Wireframe renders it as a static chip until a second locale is published. The four-language message lives in S1's "App languages:" chip instead (OD-LP-4 addendum) — the two elements are visually and semantically distinct by design.
3. **Sticky-CTA timing.** Showing the header CTA from the top doubles the CTA in the hero viewport and crowds 320px; wireframe shows it only after S1's CTA scrolls away. Costs nothing (the hero CTA is on screen before then).
4. **Portrait clips constrain desktop rows.** Phone-frame media caps at ~640px height in P2 rows so copy doesn't float in whitespace; demo recordings must stay legible at ~300px rendered width — the app's large type helps; Session 8 should verify legibility in the first test recording.
5. **Page length.** 12–14 mobile viewports incl. a ~10-question FAQ. Accepted for a narrative lander, with S13 answers hard-capped at ~3 lines (Session 7 content constraint) and S12/S14 kept as thin bands. If the owner wants it shorter, S4+S5 are the natural merge candidates ("Know & Remember") — not recommended; flagged for the gate.
6. **Two consecutive high-emphasis moments** if S9 ships (share payoff → S10 free panel). Mitigated by S9's quiet chip-row ending; S10 stays the page's only full-bleed color block until then.
7. **QR placement** is desktop-only (S1 card + S14), pointing at the same `?src=website` URL — a phone user tapping the CTA and a desktop user scanning the QR are the same funnel step; no separate QR source value in v1 (consistent with OD-LP-8's single-value ruling).

**STOP — Session 3 gate.** Next (Session 4, on approval): marketing design-system extension (`05-marketing-design-system.md`), including the deferred webfont/Nastaliq decision.
