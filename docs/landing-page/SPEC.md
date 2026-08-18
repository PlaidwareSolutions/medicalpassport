# MediDocs / Medicine Passport

# Public Website — Product, Creative, Technical & Execution Specification

**Target domain:** `https://medidocs.app`
**Patient application:** `https://app.medidocs.app`
> *Rebrand note (2026-08-15, recorded 2026-08-17):* the primary marketing apex is now **`medicinepassport.app`** (patient app `app.medicinepassport.app`), soft-launched in parallel with `medidocs.app` until a phase-3 redirect. Domain references throughout this spec are historical; see **OD-LP-11** in [01-decisions.md](01-decisions.md) for the live domain architecture.
**Document status:** EXECUTION PLAN — REVIEW BEFORE IMPLEMENTATION
**Primary implementation model:** Claude executes one approved phase at a time
**Primary audience:** Patients and caregivers
**Secondary audience:** Doctors, pharmacists, clinics and healthcare organizations

---

# 1. Executive Objective

Build `medidocs.app` as the public acquisition, education and trust layer for Medicine Passport.

The website must not behave like a conventional SaaS feature catalog.

It must tell a simple story:

**I recognize this healthcare problem → I understand the solution → I believe my family can use it → I trust it → it is free → I create my Medicine Passport.**

The primary conversion event is:

> **Create my free Medicine Passport**

which takes the user from:

`medidocs.app`

to:

`app.medidocs.app`

The website itself must never collect patient health information.

---

# 2. Primary Success Criteria

The project succeeds when the website can reliably accomplish five things.

### Patient comprehension

Within approximately the first screen or two, a first-time visitor should understand:

* what Medicine Passport is;
* who it is for;
* why it matters;
* that it works from a browser;
* that patients can use it for free;
* what action to take next.

### Emotional recognition

The visitor should recognize situations such as:

* medicines prescribed by different doctors;
* different brands containing the same ingredient;
* prescriptions and discharge papers that are difficult to understand;
* family members managing medicines remotely;
* fragmented medical documents;
* poor connectivity or older phones.

### Product proof

Instead of merely claiming capabilities, the website should visibly demonstrate the real application through controlled product recordings.

### Trust

The website must clearly communicate:

* patient control;
* consent;
* revocable sharing;
* privacy;
* the limits of the software;
* that Medicine Passport does not replace doctors.

### Conversion

The visitor must encounter a clear patient CTA repeatedly without being overwhelmed by competing actions.

---

# 3. Product Truth Rules

Claude must treat the following as hard constraints.

## 3.1 Never market Medicine Passport as an AI doctor

The product is:

* not a doctor;
* not a diagnostic system;
* not a prescribing system;
* not a substitution engine;
* not an automated declaration that a medicine is “safe.”

Safety-related information must be framed as:

* possible concerns;
* possible duplicate ingredients;
* recorded allergy matches;
* unidentified or uncertain medicines;
* questions worth discussing with a doctor or pharmacist.

Clinical decisions always belong to a qualified healthcare professional.

---

## 3.2 Do not market unshipped capabilities

Before any feature appears publicly, Claude must verify it against the application or product documentation.

Examples requiring special caution:

### Drug-drug interactions

Do not publicly advertise full drug-drug interaction checking unless it is actually enabled and clinically validated.

### Offline capabilities

It is acceptable to say that saved medicine information can be accessed and doses can be recorded offline if that remains true.

Do not claim “offline reminders” unless that specific capability is proven.

### Sharing

Advertise only sharing modes confirmed live.

Current documented core sharing is:

* time-limited share link;
* QR code;
* patient-controlled access;
* revocation;
* access logging.

Do not automatically claim PDF or WhatsApp sharing merely because they exist in roadmap material.

---

# 4. Core Positioning

## 4.1 Recommended brand architecture

Until final brand clearance:

### Primary product

**Medicine Passport**

### Endorsement

**by MediDocs**

Example:

> Medicine Passport
> by MediDocs

Alternative acceptable construction:

> MediDocs
> Your Medicine Passport

Do not invest heavily in final logos, paid advertising or irreversible brand design until name/trademark/confusion review has been completed.

---

# 5. Primary Audience Hierarchy

The website must prioritize audiences in this order.

| Priority | Audience            | Primary need                                             | CTA                              |
| -------- | ------------------- | -------------------------------------------------------- | -------------------------------- |
| 1        | Patient             | Understand and organize medicines                        | Create my free Medicine Passport |
| 2        | Family caregiver    | Manage/understand relative's medicines                   | Create a Medicine Passport       |
| 3        | Doctor/pharmacist   | Quickly understand patient-supplied medicine information | Learn about Medicine Passport    |
| 4        | Clinic/organization | Explore adoption/partnership                             | Talk to MediDocs                 |
| 5        | Partner/press       | Understand mission/product                               | Learn more                       |

Patient acquisition must never compete visually with professional lead generation.

---

# 6. Site Architecture

Recommended launch structure:

```text
medidocs.app/
├── /
│   └── Main patient/caregiver landing experience
│
├── /for-clinics/
│   └── Doctor, pharmacist, clinic and healthcare organization page
│
├── /privacy/
│   └── Public privacy policy
│
├── /terms/
│   └── Terms of use
│
├── /hi/
│   └── Hindi patient landing page
│
├── /te/
│   └── Telugu patient landing page
│
└── /ur/
    └── Urdu patient landing page, RTL
```

Optional later routes:

```text
/accessibility/
/security/
/about/
```

Do not create these merely to fill navigation.

---

# 7. Domain Architecture

Use:

```text
medidocs.app
```

for the public marketing site.

Use:

```text
www.medidocs.app
```

only as a permanent redirect to:

```text
medidocs.app
```

Existing application domains remain unchanged:

```text
app.medidocs.app
api.medidocs.app
admin.medidocs.app

staging-app.medidocs.app
staging-api.medidocs.app
staging-admin.medidocs.app
```

Recommended marketing preview:

```text
staging.medidocs.app
```

Recommended public marketing media:

```text
assets.medidocs.app
```

---

# 8. Recommended Hosting Architecture

Create:

```text
apps/marketing-web
```

inside the existing monorepo.

Recommended technology:

* Next.js;
* React;
* static export;
* Cloudflare edge/static deployment;
* no server-side runtime required for normal landing-page delivery.

Do not create another permanent Railway web service merely to serve static marketing HTML.

---

# 9. Public Media Storage

Prefer a dedicated public marketing bucket rather than casually mixing marketing files with any storage location that could someday contain sensitive information.

Recommended logical boundary:

```text
medidocs-marketing-assets
```

served through:

```text
assets.medidocs.app
```

Only publicly releasable assets may be stored there.

Examples:

```text
/video/
  hero/
  know/
  remember/
  share/
  caregiver/

/audio/
  en/
  hi/
  te/
  ur/

/images/
  posters/
  og/
  illustrations/
```

Assets should use content hashes or versioned filenames.

Example:

```text
hero-passport-en.a83f212.webm
hero-passport-en.a83f212.mp4
hero-passport-en.a83f212.jpg
```

---

# 10. Main Homepage Narrative

The homepage should follow a narrative rather than a feature inventory.

The visitor journey is:

```text
Recognition
   ↓
Problem
   ↓
Simple Solution
   ↓
Proof
   ↓
Accessibility
   ↓
Caregiving
   ↓
Sharing
   ↓
Free
   ↓
Trust
   ↓
Objection Handling
   ↓
Action
```

---

# 11. Homepage Detailed Specification

## SECTION 1 — HERO

### Objective

Explain the product in less than one screen.

### Required elements

Brand:

> Medicine Passport
> by MediDocs

Recommended headline direction:

> **Your medicines. One place. In your language.**

Supporting copy direction:

> Keep track of what you take, why you take it, when to take it, and what to show your doctor — wherever you go.

Trust/value chips:

> Free for all patients

> No app to install

> English · हिंदी · తెలుగు · اردو

Primary CTA:

> **Create my free Medicine Passport**

Link:

```text
https://app.medidocs.app
```

Secondary CTA:

> See how it works

Action:

scroll to problem/solution story.

### Hero visual

12–15 second muted application montage.

Suggested sequence:

```text
0–3 sec
Medicine Passport / current medicines screen

3–6 sec
Prescription captured and medicine details reviewed

6–9 sec
Daily schedule/timeline

9–11 sec
Listen/read-aloud interaction

11–15 sec
Doctor sharing / QR experience
```

No background music.

Use:

```html
muted
playsinline
autoplay
loop
```

with poster fallback.

---

# 12. SECTION 2 — THE PROBLEM

## Objective

Make the visitor recognize their own family situation before showing more software.

Use three situations.

---

## Story A — "Which medicines are you taking?"

Visual sequence:

doctor consultation → question → patient looking through medicine strips, prescriptions, discharge papers and phone photographs.

Copy direction:

> When every doctor has a different piece of your story, even a simple question can become difficult:
>
> “What medicines are you taking right now?”

Transition into Medicine Passport.

---

## Story B — Two names, one ingredient

Illustrate:

```text
Doctor A → Brand X
Doctor B → Brand Y
        ↓
Possible same active ingredient
```

Do not dramatize this as a medical emergency.

Copy direction:

> Different brand names can sometimes hide the same ingredient. Medicine Passport can surface possible duplicates worth asking your doctor or pharmacist about.

---

## Story C — Caring from another city

Show:

parent at home ↔ adult child elsewhere.

Explain:

* separate profiles;
* caregiver permissions;
* medication visibility;
* dose visibility where supported;
* revocable access.

---

## Section closing thesis

Recommended conceptual direction:

> **Your medicine information should travel with you — not stay scattered across prescriptions, doctors, pharmacies and hospital files.**

Then reveal:

> **That's what Medicine Passport is for.**

---

# 13. SECTION 3 — PRODUCT REVEAL

Large product visual.

Headline direction:

> **One medicine record that belongs to the patient.**

Explain the passport concept.

Show actual fields such as:

* medicine name;
* ingredient;
* strength;
* schedule;
* food instructions;
* doctor;
* reason prescribed;
* status;
* quantity where applicable.

CTA:

> Create my Medicine Passport

---

# 14. SECTION 4 — KNOW

Headline:

> **Know what you're taking.**

Product capabilities may include:

* current medicines;
* previous medicines;
* ingredient visibility;
* strength;
* instructions;
* prescribing doctor;
* reason prescribed;
* prescription photograph;
* manual entry;
* medicine search;
* prescription extraction with patient confirmation.

### Visual

8–12 second app recording.

Prefer demonstrating:

```text
prescription
   ↓
review extraction
   ↓
confirm medicine
   ↓
medicine appears in passport
```

---

# 15. SECTION 5 — REMEMBER

Headline:

> **Know what comes next.**

Capabilities may include only verified production behavior:

* daily schedule;
* dose timeline;
* taken;
* skipped;
* snoozed;
* refill awareness;
* notification options;
* missed-dose visibility;
* caregiver-related visibility where supported.

Avoid saying:

> Never miss another medicine.

That is an unrealistic guarantee.

Prefer:

> Medicine Passport helps keep today's medicines visible and organized.

---

# 16. SECTION 6 — ACCESSIBLE BY DESIGN

This should be a major selling section.

Headline direction:

> **Healthcare information should not require perfect English, perfect eyesight or a new phone.**

Show four phone screens rapidly transitioning:

```text
English
Hindi
Telugu
Urdu
```

Explicitly demonstrate Urdu RTL.

Show:

* large tap targets;
* simplified screens;
* listen button;
* slower playback where relevant;
* picture-first dose instructions.

Optional headline:

> **Read it — or listen to it.**

Narration remains opt-in.

Never autoplay spoken audio.

---

# 17. SECTION 7 — WORKS WHEN CONNECTIVITY DOESN'T

Headline:

> **Your medicine record shouldn't disappear when the network does.**

Explain only verified functionality.

For example:

* saved medicine information remains available;
* certain records can be created offline;
* changes synchronize when connectivity returns;
* visible offline state.

Do not imply that every server-backed function remains operational without connectivity.

Visual:

phone briefly goes offline → existing medicine passport still visible → connectivity returns → sync state resolves.

---

# 18. SECTION 8 — CAREGIVING

Headline:

> **Help your parents without taking control away from them.**

Explain:

* caregiver invitations;
* permissions;
* profiles;
* access visibility;
* revocation;
* remote support.

The key emotional point is:

> help can be granted, bounded, visible and revoked.

CTA for caregiver:

> Create a Medicine Passport for my family

---

# 19. SECTION 9 — SHARE WITH A DOCTOR

Headline:

> **Bring your medicine list to the appointment without bringing a folder of paper.**

Demonstrate:

patient taps share → QR appears → doctor scans → medicine summary opens.

Explain:

* doctor does not need a patient account if true;
* share link is time-limited;
* patient can revoke it;
* access is logged.

Do not suggest doctors automatically gain permanent access.

---

# 20. SECTION 10 — FREE FOR ALL PATIENTS

This is a major section.

It must visually interrupt the page.

Possible headline:

> **Medicine Passport is free for all patients.**

Subheading direction:

> Access to your own medicine information should not depend on another subscription.

### Sustainability explanation

Do not publish the final explanation until OD-LP-1 is resolved.

Placeholder:

```text
[APPROVED FREE-PATIENTS SUSTAINABILITY STATEMENT]
```

Questions that must be answered before final copy:

1. Are all patient features permanently free?
2. Could premium patient functionality ever exist?
3. Are healthcare organizations expected to fund the platform?
4. Are clinics expected to pay?
5. Could sponsors fund access?
6. Will advertising ever appear?
7. Will patient health data ever be sold?
8. Can the company credibly promise not to monetize identifiable patient health data?

The published message must exactly match the actual business model.

---

# 21. SECTION 11 — TRUST

Headline direction:

> **Designed to help you understand your medicines — not replace your doctor.**

Display clear principles.

### Medicine Passport does

* organize patient-entered medicine information;
* provide approved educational information where available;
* surface certain possible concerns;
* allow patient-controlled sharing;
* maintain access visibility and auditability where implemented.

### Medicine Passport does not

* diagnose;
* prescribe;
* tell patients to start medication;
* tell patients to stop medication;
* substitute medicines;
* declare medicines universally safe;
* replace doctors or pharmacists.

Trust should be presented as product value rather than legal fine print.

---

# 22. SECTION 12 — HEALTHCARE PROFESSIONAL BRIDGE

Keep this short on the main homepage.

Example:

> **Are you a doctor, pharmacist or clinic?**

Supporting copy:

> See how patient-held Medicine Passports can make medication information easier to review at the point of care.

CTA:

> Learn about Medicine Passport for healthcare professionals

Route:

```text
/for-clinics/
```

Do not embed a large sales form into the middle of the patient story.

---

# 23. SECTION 13 — FAQ

Initial FAQ candidates:

### Is Medicine Passport really free?

Use approved OD-LP-1 language.

### Do I need to install an app?

Explain browser/PWA behavior truthfully.

### Which languages are supported?

English, Hindi, Telugu and Urdu where production quality/review has been approved.

### Can my family help manage my medicines?

Explain caregiver capability.

### Does my doctor need a MediDocs account?

Explain the verified sharing path.

### Can Medicine Passport tell me whether two medicines are safe together?

Answer carefully.

### Does Medicine Passport replace medical advice?

No.

### What happens if I have no internet?

Explain exact offline capabilities.

### Who can see my information?

Explain consent and sharing.

### Can I stop sharing with someone?

Explain revocation where supported.

---

# 24. FINAL CTA

The footer conversion block should repeat the emotional proposition.

Example conceptual structure:

> **Take your medicine information with you.**

> Start your Medicine Passport today.

Button:

> **Create my free Medicine Passport**

Include QR code on desktop.

Do not require the patient to submit a marketing lead form.

---

# 25. `/for-clinics/` PAGE SPECIFICATION

This page has a different conversion objective.

Primary audience:

* physicians;
* pharmacists;
* clinic owners;
* hospital administrators;
* care coordinators;
* healthcare organizations.

Core story:

```text
Patient arrives
   ↓
Medication information is fragmented
   ↓
Patient presents Medicine Passport
   ↓
Professional reviews structured list
   ↓
Patient retains ownership/control
```

Suggested sections:

### Hero

> **A clearer medication picture, brought by the patient.**

### Problem

Medication reconciliation can be difficult when information is scattered.

Avoid unsupported clinical-efficiency statistics.

### What the professional sees

Demonstrate real shared summary.

### No new professional account required

Only state if still accurate.

### Patient-controlled access

Explain:

* consent;
* temporary link;
* QR;
* revocation;
* access logging.

### Why clinics might care

Use non-clinical-outcome claims unless validated.

Examples:

* easier access to patient-supplied medication information;
* structured medicine view;
* fewer paper records to manually interpret;
* patient-controlled information exchange.

### Lead CTA

> Bring Medicine Passport to your patients

---

# 26. PROFESSIONAL LEAD FORM

Recommended fields:

```text
Name *
Organization / Clinic *
Role *
City *
Email OR Phone *
Message
Consent to be contacted *
```

At least one of email/phone required.

Do not collect:

* patient name;
* diagnosis;
* prescription;
* medicine list;
* health history.

Recommended backend:

```text
POST /v1/public/leads
```

Protection:

* Cloudflare Turnstile;
* API rate limiting;
* server-side validation;
* audit timestamp;
* spam controls.

Initial storage:

Postgres is acceptable.

---

# 27. PUBLIC SUPPORT REQUIREMENT

Before public launch, establish real destinations for:

```text
support@
privacy@
security@
partnerships@
```

These may map to fewer actual inboxes internally, but responsibility must be defined.

Create:

### OD-LP-7

**Public support, privacy and grievance ownership**

For each channel define:

* recipient;
* backup recipient;
* expected handling procedure;
* escalation owner;
* where requests are logged.

Do not publish contact information that nobody monitors.

---

# 28. PRIVACY AND TERMS

The website must have publicly accessible:

```text
/privacy/
/terms/
```

Do not allow Claude to invent legal policy language and silently publish it as approved legal text.

Claude may:

* create policy structure;
* create placeholders;
* identify product/data flows;
* draft language for legal review.

Final approval must come from whoever is designated to own legal/privacy review.

---

# 29. LOCALIZATION STRATEGY

Recommended sequence:

### Launch first

English.

### Then

Hindi.

### Then

Telugu.

### Then

Urdu.

Do not block the English public website merely because professional translation review for other languages is unfinished.

Architecture must support all four from day one.

Routes:

```text
/
 /hi/
 /te/
 /ur/
```

Urdu:

```text
dir="rtl"
```

must apply to the document/layout where appropriate.

Do not merely mirror text while leaving component hierarchy visually broken.

---

# 30. LANGUAGE DETECTION

Do not forcibly redirect visitors based solely on browser language.

Better:

```text
Browser suggests Hindi
        ↓
"हिंदी में देखें?"
        ↓
User chooses
```

Persist user choice if appropriate.

Language switcher must remain visible.

---

# 31. SEO SPECIFICATION

Each locale should have:

* unique page title;
* localized meta description;
* canonical URL;
* hreflang;
* OpenGraph metadata;
* social preview image.

Create:

```text
sitemap.xml
robots.txt
```

Structured data may include:

```text
WebSite
FAQPage
Organization
```

Do not add medical efficacy or treatment-result schema implying unsupported claims.

---

# 32. MEDIA STRATEGY

The page must remain excellent when zero video bytes are downloaded.

This is a hard requirement.

Media is progressive enhancement.

---

# 33. VIDEO SPECIFICATION

Recommended formats:

```text
WebM
MP4/H.264
poster JPEG/WebP
```

Hero:

```text
12–15 seconds
loop
muted
playsinline
```

Section demos:

```text
8–12 seconds
```

Below-fold videos:

```text
preload="none"
```

Load only when approaching viewport where practical.

---

# 34. PRODUCT RECORDING PIPELINE

Do not manually screen-record random sessions.

Create deterministic recordings.

Workflow:

```text
Seed demo account
    ↓
Playwright launches staging
    ↓
Playwright performs scripted flow
    ↓
Recording generated
    ↓
Crop/stabilize
    ↓
Add device treatment if needed
    ↓
Compress
    ↓
Generate poster
    ↓
Generate captions/transcript
    ↓
Publish asset
```

Marketing demo data must be unmistakably fictional.

Never use real patient data.

---

# 35. INITIAL VIDEO STORYBOARD SET

Create at minimum:

```text
01-hero
02-add-medicine
03-today-schedule
04-listen-language
05-caregiver
06-share-doctor
07-offline
```

Every video should answer one question.

Do not create videos merely because animation looks impressive.

---

# 36. AUDIO STRATEGY

No autoplay audio.

Narration must require explicit interaction.

Button examples:

```text
Listen
Hear this in Hindi
తెలుగులో వినండి
اردو میں سنیں
```

Where practical, reuse the product's established spoken-content pipeline so the website and application feel related.

Provide:

* transcript;
* pause control;
* replay control;
* visible playing state.

---

# 37. MOTION STRATEGY

Preferred:

* subtle scroll reveal;
* small transitions;
* product cross-fades;
* light illustrations;
* restrained micro-interactions.

Avoid:

* parallax-heavy pages;
* constantly moving backgrounds;
* 3D scenes;
* large animation frameworks unless justified;
* decorative animation that delays comprehension.

If:

```css
prefers-reduced-motion: reduce
```

then remove nonessential motion.

---

# 38. PERFORMANCE BUDGET

Initial target:

### Critical page before rich media

Approximately:

```text
≤ 100–150 KB compressed critical path
```

Treat this as an engineering budget, not a guarantee before measurement.

Primary requirements:

* no layout shifts around media;
* explicit aspect ratios;
* lazy media;
* image optimization;
* no unnecessary component library;
* no giant icon bundle;
* no animation framework without justification.

Performance must be tested on realistic mobile network conditions.

---

# 39. SAVE-DATA BEHAVIOR

Where browser/network signals permit reduced-data behavior:

Use:

```text
poster instead of autoplay video
```

Avoid prefetching heavy media.

The site must retain:

* copy;
* CTA;
* structure;
* screenshots/posters;
* complete usability.

---

# 40. RESPONSIVE DESIGN

Design mobile-first.

Primary width assumptions:

```text
320 px minimum
390 px common design reference
768 px tablet
1280+ desktop
```

Mobile CTA should remain visually obvious.

Desktop may include:

* QR next to primary CTA;
* side-by-side phone/product visual.

Do not make desktop the canonical experience.

---

# 41. ACCESSIBILITY ACCEPTANCE CRITERIA

Require:

* semantic HTML;
* keyboard navigation;
* visible focus;
* descriptive button names;
* transcripts;
* captions;
* sufficient contrast;
* touch targets appropriate for mobile;
* RTL verification;
* zoom testing;
* reduced motion;
* no information conveyed by color alone.

No video should contain critical information that does not exist in nearby text.

---

# 42. ANALYTICS MODEL

Do not measure merely pageviews.

Measure the conversion funnel.

Recommended anonymous marketing events:

```text
landing_view
language_change
hero_start_click
section_start_click
clinic_page_click
clinic_lead_start
clinic_lead_submit
```

Application-side acquisition events should allow understanding of:

```text
marketing CTA
      ↓
signup started
      ↓
OTP completed
      ↓
first profile established
      ↓
first medicine added
```

Do not send:

* medicine names;
* diagnosis;
* prescription text;
* health measurements;
* patient health content

into marketing analytics.

---

# 43. UTM / ATTRIBUTION

Patient CTA may carry privacy-safe attribution.

Example:

```text
https://app.medidocs.app/?src=website
```

or an equivalent controlled mechanism.

Define exact attribution contract before implementation.

Do not pass arbitrary sensitive query-string values between the marketing site and patient application.

---

# 44. MARKETING CLAIM LEDGER

Create a file:

```text
docs/marketing-claims.md
```

Recommended schema:

| Claim ID | Public claim | Feature source | Production verified | Clinical/legal review | Approved wording |
| -------- | ------------ | -------------- | ------------------- | --------------------- | ---------------- |

Example:

| MKT-001 | Medicine Passport is free for all patients | Business decision | Pending | Business | Pending |
| MKT-002 | Works from a mobile browser | Product | Yes | N/A | Approved |
| MKT-003 | Available in four languages | Product | Verify review gate | Translation | Pending |
| MKT-004 | Can surface possible duplicate ingredients | Safety capability | Verify production | Clinical | Pending |
| MKT-005 | Doctor can scan QR | Sharing | Verify production | Privacy | Pending |

Every safety, privacy, medical or business-model claim on the website must exist in this ledger.

---

# 45. DECISIONS REQUIRED BEFORE DEVELOPMENT

## OD-LP-1 — Free-for-patients business model

Must resolve before final copy.

## OD-LP-2 — Professional lead workflow

Decide:

* fields;
* owner;
* notification;
* follow-up process.

## OD-LP-3 — Public brand architecture

Recommended provisional:

> Medicine Passport by MediDocs

Perform formal brand review separately.

## OD-LP-4 — Localization launch sequence

Recommended:

English first.

## OD-LP-5 — Hosting

Recommended:

Cloudflare static deployment.

## OD-LP-6 — Legal ownership

Assign privacy/terms reviewer.

## OD-LP-7 — Support/privacy contact ownership

Assign monitored operational channels.

## OD-LP-8 — Marketing analytics strategy

Determine exactly which analytics mechanism will capture custom events.

## OD-LP-9 — Marketing asset security boundary

Recommended:

dedicated public marketing R2 bucket.

---

# 46. EXECUTION SCHEDULE

Do not ask Claude to implement the entire website in one conversation/session.

Use the following sequence.

Each session should end with:

1. files changed;
2. tests executed;
3. screenshots/output where appropriate;
4. unresolved issues;
5. documentation update;
6. explicit STOP before next phase.

---

# SESSION 0 — PROJECT AUDIT

## Objective

Claude learns the existing repository before changing anything.

### Claude must inspect

```text
repo structure
package manager
Next.js versions
shared design tokens
i18n implementation
Cloudflare configuration
Railway configuration
R2 configuration
CI workflows
Playwright
existing documentation
patient CTA/login flow
current production capabilities
current privacy-related infrastructure
```

### Deliverables

Create:

```text
docs/landing-page/00-current-state-audit.md
```

Include:

* architecture;
* relevant reusable packages;
* technical constraints;
* existing CI patterns;
* claim discrepancies;
* risks.

### Gate

No implementation yet.

---

# SESSION 1 — DECISION REGISTER + TRUTH INVENTORY

## Objective

Turn assumptions into explicit decisions.

### Create

```text
docs/landing-page/01-decisions.md
docs/landing-page/02-marketing-claims.md
```

### Claude should

* populate OD-LP-1 through OD-LP-9;
* mark decisions as OPEN/APPROVED/REJECTED;
* inventory potential public claims;
* verify each claim against code/docs where possible.

### Gate

You personally review and decide unresolved business questions.

Claude must stop.

---

# SESSION 2 — INFORMATION ARCHITECTURE + COPY SKELETON

## Objective

Design the website before coding it.

### Create

```text
docs/landing-page/03-information-architecture.md
docs/landing-page/04-content-spec.md
```

Include every section described in this specification.

For each section document:

```text
purpose
audience thought
headline
supporting copy
CTA
visual
product evidence
claim IDs
mobile layout
desktop layout
accessibility behavior
```

### Gate

You approve the story.

No polished visual design yet.

---

# SESSION 3 — WIREFRAMES

## Objective

Translate narrative into layouts.

Claude should produce text/HTML-level wireframes or lightweight prototype screens.

Required:

```text
mobile homepage
desktop homepage
mobile /for-clinics
desktop /for-clinics
```

Also define:

* sticky navigation behavior;
* language switcher;
* CTA placement;
* footer.

### Gate

Review page density and story flow.

---

# SESSION 4 — DESIGN SYSTEM EXTENSION

## Objective

Define public marketing design without diverging from the application identity.

Reuse where sensible:

* typography;
* green;
* radii;
* spacing logic;
* icons.

Add marketing-specific tokens only when required.

Create:

```text
docs/landing-page/05-marketing-design-system.md
```

Document:

```text
type scale
spacing
surfaces
buttons
cards
illustration style
video treatment
phone frame treatment
motion behavior
breakpoints
RTL behavior
```

### Gate

Approve visual direction.

---

# SESSION 5 — TECHNICAL FOUNDATION

## Objective

Build the static application shell.

Create:

```text
apps/marketing-web
```

Implement:

* Next.js configuration;
* static export;
* routing;
* shared tokens;
* base navigation;
* footer;
* English layout;
* locale architecture;
* accessibility baseline.

Create placeholder routes:

```text
/
/for-clinics/
/privacy/
/terms/
/hi/
/te/
/ur/
```

Do not fill untranslated languages with misleading translated copy.

### Acceptance

* local build works;
* static export succeeds;
* no runtime server dependency;
* lint/typecheck passes.

---

# SESSION 6 — CLOUDFLARE + DOMAIN FOUNDATION

## Objective

Deploy a safe preview before public apex cutover.

Implement:

```text
staging.medidocs.app
```

or equivalent preview.

Configure:

```text
www → apex redirect
```

but do not point public apex until launch approval if it currently has no production page.

Configure public marketing asset storage.

### Verify

* TLS;
* headers;
* caching;
* redirects;
* staging access;
* no patient data exposure.

---

# SESSION 7 — ENGLISH CONTENT IMPLEMENTATION

## Objective

Implement full static English story using placeholder media/posters.

Build:

* Hero;
* Problem;
* Passport reveal;
* Know;
* Remember;
* Accessibility;
* Offline;
* Caregiver;
* Share;
* Free;
* Trust;
* Professional bridge;
* FAQ;
* Final CTA.

Every public claim must reference an approved claim ID internally.

### Gate

You review the complete page before video production.

---

# SESSION 8 — MEDIA RECORDING FRAMEWORK

## Objective

Build a repeatable demo-media pipeline.

Create fictional staging demo dataset.

Create deterministic Playwright flows.

Suggested scripts:

```text
marketing-hero.spec.ts
marketing-add-medicine.spec.ts
marketing-schedule.spec.ts
marketing-listen.spec.ts
marketing-caregiver.spec.ts
marketing-share.spec.ts
marketing-offline.spec.ts
```

Do not publish recordings yet.

### Gate

Review actual staging data and recording flows.

---

# SESSION 9 — MEDIA PRODUCTION

## Objective

Generate optimized marketing media.

Produce:

```text
hero
add medicine
schedule
listen/languages
caregiver
sharing
offline
```

For each create:

```text
.webm
.mp4
poster
captions
transcript
```

Publish to marketing assets domain.

Replace placeholders.

Verify no real patient information appears anywhere.

---

# SESSION 10 — PROFESSIONAL PAGE + LEAD SYSTEM

## Objective

Build `/for-clinics/`.

Implement approved lead form.

Backend:

```text
POST /v1/public/leads
```

Add:

* Turnstile;
* validation;
* rate limiting;
* storage;
* notification/workflow;
* test coverage.

No patient health fields permitted.

---

# SESSION 11 — ANALYTICS

## Objective

Instrument only approved privacy-safe events.

Implement:

```text
landing_view
hero_start_click
language_change
clinic_page_click
clinic_lead_start
clinic_lead_submit
```

Create attribution handoff to patient application if approved.

Verify that no health content enters analytics.

---

# SESSION 12 — LEGAL + SUPPORT

## Objective

Replace placeholders.

Publish reviewed:

```text
/privacy/
/terms/
```

Verify public:

```text
support channel
privacy channel
security channel
professional contact
```

Verify owners are real.

---

# SESSION 13 — LOCALIZATION

## Objective

Add professionally reviewed languages incrementally.

Sequence:

```text
Hindi
Telugu
Urdu
```

For each language:

* translated copy;
* reviewed claims;
* metadata;
* FAQ;
* audio where appropriate;
* correct typography;
* language switcher;
* hreflang.

For Urdu additionally verify:

```text
RTL
mixed Latin text
phone numbers
medicine names
CTA alignment
icons
navigation direction
```

---

# SESSION 14 — ACCESSIBILITY + PERFORMANCE

Test:

```text
320px viewport
200% zoom
keyboard
screen reader semantics
reduced motion
Save-Data
low-end Android assumptions
iOS Safari
Chrome Android
desktop Chrome
desktop Safari
RTL
```

Run:

```text
Lighthouse
axe
existing CI accessibility checks where reusable
```

Fix all severe accessibility issues before launch.

---

# SESSION 15 — SECURITY + CLAIM AUDIT

Re-review every public sentence.

Confirm:

```text
No unsupported drug-interaction claim
No unsupported offline reminder claim
No unsupported sharing method
No fake testimonials
No invented statistics
No absolute safety language
No diagnosis language
No implication of replacing professionals
No patient information in analytics
No sensitive data in marketing R2
```

Produce:

```text
docs/landing-page/06-launch-claim-audit.md
```

---

# SESSION 16 — LAUNCH READINESS

Create launch checklist.

Verify:

```text
DNS
TLS
www redirect
assets domain
apex routing
staging routing
robots
sitemap
canonical
hreflang
OpenGraph
analytics
CTA
QR
lead form
privacy
terms
support
404
error behavior
performance
accessibility
mobile
desktop
```

Do not launch automatically.

Claude stops and requests your explicit launch authorization.

---

# SESSION 17 — PRODUCTION CUTOVER

Only after explicit approval.

Deploy approved production build.

Verify:

```text
https://medidocs.app
https://www.medidocs.app
https://assets.medidocs.app
https://app.medidocs.app
```

Perform live smoke tests.

Capture production screenshots.

Document deployed commit.

---

# SESSION 18 — POST-LAUNCH VALIDATION

Review:

* broken links;
* CTA flow;
* conversion instrumentation;
* mobile performance;
* lead delivery;
* indexing;
* media loading;
* errors.

Produce:

```text
docs/landing-page/07-post-launch-report.md
```

Do not make creative changes based on tiny amounts of early traffic.

First confirm instrumentation is correct.

---

# 47. CLAUDE WORKING RULES

Use this instruction at the beginning of every implementation session:

> Work only on the requested landing-page phase.
> Read the relevant project documentation and inspect existing implementation before making changes.
> Do not assume roadmap features are live.
> Never invent product capabilities.
> Never change business decisions marked OPEN.
> Never silently decide unresolved branding, legal, privacy, clinical, pricing or sustainability questions.
> Reuse existing project patterns where appropriate.
> Keep patient data completely outside the marketing application.
> At the end of the phase, run applicable tests, document files changed, list unresolved issues, update the landing-page documentation, and STOP. Do not begin the next phase until I approve it.

---

# 48. SESSION 0 CLAUDE PROMPT

> We are beginning the MediDocs / Medicine Passport public landing-page project.
>
> Do NOT implement anything yet.
>
> Read the existing repository, especially documentation describing:
>
> * product vision;
> * product boundaries;
> * personas;
> * patient-web architecture;
> * Cloudflare/R2 architecture;
> * accessibility;
> * localization;
> * clinical validation;
> * open decisions;
> * production deployment.
>
> Inspect the actual repo to verify:
>
> * monorepo structure;
> * apps/packages;
> * Next.js versions;
> * shared design tokens;
> * i18n implementation;
> * Playwright infrastructure;
> * Cloudflare configuration;
> * R2 configuration;
> * Railway configuration;
> * CI/CD;
> * production feature state.
>
> Then create:
>
> `docs/landing-page/00-current-state-audit.md`
>
> The audit must describe what can be reused, what assumptions in the proposed landing-page specification are correct or incorrect, implementation risks, and any claims that require verification.
>
> Do not modify application behavior.
>
> At the end, summarize findings and STOP for my review.
