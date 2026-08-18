# Landing Page — Decision Register (OD-LP-1 … OD-LP-9)

**Opened:** 2026-08-11 · **Rulings recorded:** 2026-08-11 (Session 1 gate), 2026-08-11 (Session 2 gate: OD-LP-10 ruled, OD-LP-4 addendum, content-spec corrections)
**Current state: 8 APPROVED (OD-LP-1 with boundaries, OD-LP-2 with configurable routing, OD-LP-10 with split gating), 2 OPEN.** OD-LP-6 and OD-LP-7 are **hard pre-launch gates** (Session 12/16). **Stage 7 security gate: CLEARED 2026-08-12** (professional unit unlocked for Session 10 but not yet enabled). OPEN decisions are never resolved, assumed, or worked around by Claude.

Related project-wide register: [../24-open-decisions-and-assumptions.md](../24-open-decisions-and-assumptions.md) (OD-3/OD-4 interaction data, OD-10 WhatsApp, OD-13 observability intersect here and stay tracked there). New decisions discovered after this register was ruled are appended in §"Discovered decisions".

---

## OD-LP-1 — Free-for-patients business model · **APPROVED WITH BOUNDARIES** (2026-08-11)

**Ruling:** Medicine Passport is free for all patients. Patients are not charged to create, maintain, access or share their Medicine Passport. The intended sustainability model is services/partnerships with healthcare organizations and professional offerings rather than charging patients for access to their own medicine information. **Do not state that every possible future optional feature is guaranteed free forever.** Established marketing principles: there will be **no advertising in the patient experience**; **identifiable patient health information will not be sold**; **access to a patient's own core Medicine Passport will not be placed behind a paywall**. Final published sustainability wording still requires business/legal copy review.

**Owner's candidate copy direction** (draft, still subject to that review): *"Free for all patients. Your medicine information belongs to you. Medicine Passport is free for all patients to create, maintain and share. We plan to sustain MediDocs through services and partnerships with healthcare organizations — not by charging patients for access to their own medicine information."*

**Answers to SPEC §20's eight questions, as bounded by the ruling:** (1) the core patient passport — create/maintain/access/share — is free; (2) future *optional* capabilities are not promised free forever; (3–5) healthcare organizations, partnerships and professional services are the intended funding path; sponsors not addressed — treat as unpromised; (6) no advertising in the patient experience; (7–8) identifiable patient health information will not be sold. Ledger rows MKT-001/MKT-072 updated; prohibited phrasing added as MKT-006.

**Session 2 gate clarification (2026-08-11):** the "identifiable patient health information is never sold" principle remains **GATED-BUSINESS/LEGAL** — it stays in the content specification as *intended policy wording* but does not become approved public copy until that permanent commitment receives the appropriate business/legal approval.

---

## OD-LP-2 — Professional lead workflow · **APPROVED WITH OPERATIONAL ROUTING CONFIGURABLE** (2026-08-12)

**Ruling:** fields are Name*, Organization/Clinic*, Role*, City*, Email OR Phone* (at least one), Message (optional), Consent to be contacted*. The form **never** collects patient health information. Initial lead storage uses the existing Postgres infrastructure; **no CRM vendor in V1**. The internal notification/follow-up recipient stays **configurable rather than hardcoded** until the operational owner is finalized. This ruling does **not** authorize Session 10 implementation — it was recorded during the Stage-7 security-review session and takes effect when the professional lead form is actually built.

**Known constraints** (unchanged): Postgres + Turnstile-guarded `@Public()` endpoint fully supported by existing patterns (audit §1.8); edge rate-limit slot unavailable on the Free plan, so protection is app-level + Turnstile.

---

## OD-LP-3 — Public brand architecture · **APPROVED** (2026-08-11)

**Ruling:** brand architecture is **"Medicine Passport by MediDocs."** Medicine Passport is the patient-facing product name; MediDocs is the company/platform brand. Product-oriented CTAs — *"Create my free Medicine Passport"*, never *"Create my MediDocs account."* Product sentences lead with Medicine Passport; footer/company/legal references say MediDocs. Formal trademark/name clearance remains a separate pre-scale business task and does **not** block Session 2; no heavy investment in final logos or irreversible brand design until it clears.

---

## OD-LP-4 — Localization launch sequence · **APPROVED** (2026-08-11)

**Ruling:** **English-first public launch.** Site architecture must support English/Hindi/Telugu/Urdu from day one (`/`, `/hi/`, `/te/`, `/ur/`), but Hindi/Telugu/Urdu are not publicly treated as finished until professional review clears them. **Do not machine-translate public marketing copy and mark it complete/production-ready.** Unreviewed locale routes exist architecturally but are not published/linked as done.

**Addendum (Session 2 gate, 2026-08-11):**
- **Product-language vs. website-language distinction:** during English-only launch these must be **visually distinct**. The hero *may state* that Medicine Passport (the product) supports English, Hindi, Telugu and Urdu; the site **language switcher lists only public locales whose marketing translations have passed review**. Content spec applies this via an "App languages:" chip treatment distinct from the switcher.
- **`/for-clinics/` launches English-only in V1** — architected so localization can be added later; professional-page localization is **not** part of the initial launch gate.

---

## OD-LP-5 — Hosting architecture · **APPROVED** (2026-08-11)

**Ruling:** `apps/marketing-web`, Next.js **static export**, deployed through Cloudflare at `medidocs.app`. **No fourth Railway runtime.** Retain `www.medidocs.app` → apex redirect, and preferably `staging.medidocs.app` for review. Static-export security/cache headers belong in the **Cloudflare deployment configuration** (audit §5.5: `next.config` `headers()` does not apply to exported output).

---

## OD-LP-6 — Legal ownership (privacy/terms) · **OPEN** — hard pre-launch gate

Stays OPEN. Claude may draft structure and candidate language later (Session 12) but cannot approve legal text; a named owner must review and approve `/privacy/` and `/terms/` before launch. Privacy copy must describe today's actual product behavior — notably no self-serve export/deletion exists (MKT-073) — not target-state plans.

---

## OD-LP-7 — Public support, privacy and grievance ownership · **OPEN** — hard pre-launch gate

Stays OPEN. Before launch, `support@` / `privacy@` / `security@` / `partnerships@` need real operational routing — they may all technically route to one monitored mailbox initially; the requirement is a real owner and a response process, not four teams. No contact information is published that nobody monitors.

---

## OD-LP-8 — Marketing analytics strategy · **APPROVED FOR V1** (2026-08-11)

**Ruling:** deliberately minimal launch model —

1. **Cloudflare Web Analytics** for aggregate website traffic/performance (pageviews, Core Web Vitals; no custom events, accepted).
2. **Privacy-safe first-party attribution** from landing-page CTAs into the app: a controlled source value such as `https://app.medidocs.app/?src=website`, with the patient application recording the acquisition source when signup starts/completes — enabling the funnel that matters: landing traffic → clicks into app → signup starts → OTP succeeds → first medicine added.
3. **Clinic conversion measured by the lead backend itself** — the `/v1/public/leads` submission is the conversion event.

**Do not build** a generic marketing event-collection service or Workers Analytics Engine integration for V1 unless Session 11 reveals a concrete requirement; revisit richer event analytics after launch only on demonstrated need. Section-level micro-interactions are explicitly not measured. (Note: the app-side capture of `src` is a patient-web change scheduled with Session 11, with its own privacy-safe handling — the marketing site only *sends* the parameter.)

---

## OD-LP-9 — Marketing asset security boundary · **APPROVED** (2026-08-11)

**Ruling:** dedicated public marketing asset bucket — preferably `medidocs-marketing-assets`, or the nearest account-compliant `medidocs-`/`medpass-`-scoped name — served through `assets.medidocs.app`. **Hard rule: the bucket may contain public marketing assets only and must never contain patient documents, health information, or private application artifacts.** Hash-versioned filenames per SPEC §9. Existing empty `medpass-*-public-assets` buckets stay untouched by this project.

---

## Session 4 gate rulings (2026-08-11) — design system

1. **Page ground — APPROVED:** warm paper `#fbfaf7` is the default marketing-page background; white remains for cards, device surfaces, forms, and panels where neutral separation helps. Implemented as a **semantic token** (`--mkt-paper`), never hardcoded in components, so it can change globally later.
2. **Illustration accents — APPROVED WITH BOUNDARIES:** clay/terracotta and sand are restrained illustration-support colors **only** — never CTA, navigation, link, product-status, or competing-brand colors. Green `#0f6b54` remains the sole primary brand/action hue. Future canonical illustrations are reviewed **as one coherent family** (saturation, stroke, skin-tone handling, cultural neutrality, consistency).
3. **Interim MP monogram — PARTIALLY APPROVED:** favicon/small-icon contexts only. It does **not** become the OG/social identity; initial OG imagery prefers the "Medicine Passport by MediDocs" lockup + authentic product UI, since the brand mark is provisional.
4. **Nastaliq — DEFERRED:** no Urdu webfont now; the documented locale-scoped option is retained and revisited when `/ur/` approaches publication; no Urdu font payload ever on the English critical path.

Plus three implementation principles added to [05-marketing-design-system.md](05-marketing-design-system.md): marketing-specific values (ground, accents, surfaces, widths, spacing) are semantic tokens; reuse the product's visual language without forcing the marketing site to look like an app screen; marketing may be more editorial (typography, whitespace, storytelling, illustration) while keeping recognizable MediDocs colors, controls, and product imagery.

## Discovered decisions (post-ruling; appended as they arise)

### OD-LP-10 — Gate handling at launch · **APPROVED WITH SPLIT GATING** (2026-08-11)

Discovered in Session 2: three review gates sit under large parts of the page story — **Stage 7 security review** (every sharing claim: homepage S9 and most of `/for-clinics/`), **clinical validation / H-27** (safety-findings copy, Story B's product tie-in, some reminder/education wording), **translation review** (non-English site copy; see OD-LP-4 addendum for the product-language statement).

**Ruling (split gating):**
- **Security review is a hard launch gate for the sharing story.** The public sharing capability and all sharing claims are not marketed or exposed until Stage 7 security review clears them.
- **Clinical review gates the clinical/safety-related marketing claims, not the entire launch.** If clinical review is incomplete at launch time, the gated safety claims and related product tie-ins are removed/disabled rather than blocking otherwise-approved sections.
- **Preserve the complete architecture** so gated sections/sentences can be enabled after their approvals, without redesign.

**Stage 7 security review CLEARED (2026-08-12) — see [stage7-sharing-security-review.md](stage7-sharing-security-review.md), `STAGE 7 RESULT: PASS`.** The existing patient-controlled sharing capability was reviewed as a bearer-credential system: 256-bit CSPRNG tokens stored only as SHA-256 hashes, owner-scoped authorization (cross-patient access returns 404), server-enforced expiry/revocation, minimized public payload (no document handles), no-store caching, no XSS, audited access. Three findings, all fixed: F1 MEDIUM (share pages lacked `noindex` → `X-Robots-Tag: noindex` added to patient-web; applies on next deploy), F2 LOW (internal medication id removed from the public payload), F3 (cross-patient IDOR regression test added). Suites green (API 304/304, sharing 19/19, patient-web 14/14). **This clears the gate but does not enable the professional unit** — `PROFESSIONAL_UNIT_ENABLED` stays OFF; enabling S9/S12/`/for-clinics/`/lead path is Session 10 work, each still on its own approval. Stage-7-gated marketing claims are individually reconciled in the review doc §K (notably "revocable" wording must not imply an already-downloaded PDF can be remotely erased).

**Addendum (Session 3 gate, 2026-08-11) — the professional experience is one gated release unit:** before Stage 7 security review clears, do **not** publicly publish `/for-clinics/`, its lead form, or homepage S12 (professional bridge) — C1/C3/C4/C5 depend materially on the patient-sharing capability, and a pre-clearance professional page would expose a lead form without the product proof that makes it credible. The unit **S9 sharing → S12 bridge → `/for-clinics/` → professional lead path** enables together once Stage 7 clears the relevant sharing implementation and claims. Before clearance, the homepage transitions directly S11 → S13 via the clean seam already defined. **No public "coming soon" clinics page** unless the owner explicitly requests one later.

### OD-LP-11 — Domain rebrand to `medicinepassport.app` · **PHASE 1 EXECUTED** (2026-08-15; recorded 2026-08-17)

Owner decision executed in commits `2dec9a5` + `1431846`: **`medicinepassport.app` is the primary marketing apex going forward**; `medidocs.app` keeps serving its own separately-branded artifact in parallel until a redirect cuts it over. This entry records the phased plan so the register matches live reality (the rebrand previously existed only in commit messages).

- **Phase 1 — DONE (2026-08-15):** marketing origin parameterized (`NEXT_PUBLIC_SITE_ORIGIN`/`NEXT_PUBLIC_APP_ORIGIN`); separate Worker `medicinepassport-marketing-production` (`wrangler.medicinepassport.toml`) + `deploy:soft-launch:medicinepassport`; own Web-Analytics site (token `398ad7c0…`); lead Turnstile widget hostname extended by owner; prod API `CORS_ORIGINS` + `LEAD_TURNSTILE_HOSTNAMES` include the new apex (and `app.medicinepassport.app` pre-added for phase 2). Live-verified noindexed with correct canonical.
- **Phase 2 — app host (live, verified 2026-08-17):** `app.medicinepassport.app` serves the patient app, and the **patient-app** Turnstile widget (`0x4AAAAAAD7CYz9zDT2RqibR`) accepts the new hostname — live headless probe of `/login` on both app hosts rendered the identical healthy interactive challenge (an unlisted domain visibly errors with code 110200 instead), and the OTP `verifyTurnstile` call passes no hostname allowlist server-side, so the widget-level allowlist is the only hostname gate. A real human OTP login on the new host is folded into the next real-device pass as final confirmation. `api.`/`admin.`/`assets.` stay on `medidocs.app` for now — the API host is deliberately un-rebranded until a coordinated cutover.
- **Phase 3 — NOT STARTED:** `medidocs.app → medicinepassport.app` 301 redirect (plus `www` records on both apexes, currently absent). Until phase 3, both apexes serve full copies — acceptable only while noindexed; **the redirect must land before indexing is enabled** or it becomes a duplicate-content problem.
- **Open sub-questions (owner):** which domain the OD-LP-7 public mailboxes live on (recommend `medicinepassport.app` as the go-forward brand); whether "Medicine Passport by MediDocs" copy (OD-LP-3) is retained verbatim on the new apex; a per-domain OG image (current OG bakes the medidocs-era lockup).

---

## Status summary

| OD | Topic | Status | Notes |
|---|---|---|---|
| OD-LP-1 | Free-for-patients model + promise scope | **APPROVED WITH BOUNDARIES** | Final wording still passes business/legal copy review |
| OD-LP-2 | Lead workflow + owner | **APPROVED — routing configurable** | Fields fixed; Postgres, no CRM; follow-up recipient stays configurable (ruled 2026-08-12) |
| OD-LP-3 | Brand lockup | **APPROVED** | "Medicine Passport by MediDocs"; trademark review separate, non-blocking |
| OD-LP-4 | Localization sequence | **APPROVED** | English-first; 4-locale architecture day one; no machine-translated "complete" copy |
| OD-LP-5 | Hosting | **APPROVED** | Static export on Cloudflare; headers at Cloudflare layer; www + staging retained |
| OD-LP-6 | Legal review owner | **OPEN** | Hard pre-launch gate |
| OD-LP-7 | Support-channel ownership | **OPEN** | Hard pre-launch gate; one monitored mailbox acceptable initially |
| OD-LP-8 | Analytics | **APPROVED FOR V1** | CWA + `?src=website` attribution + lead-backend conversion; no event platform |
| OD-LP-9 | Marketing bucket | **APPROVED** | Dedicated `medidocs-marketing-assets` (or compliant name) via `assets.medidocs.app`; public-only, hard boundary |
| OD-LP-10 | Gate handling at launch | **APPROVED — SPLIT GATING** | Security review = hard gate for the sharing story; clinical review gates claims only (remove/disable at launch if incomplete); architecture preserved for post-approval enablement |
| OD-LP-11 | `medicinepassport.app` rebrand | **PHASE 1 EXECUTED** | New primary marketing apex live (noindexed); phase 2 app host live + Turnstile hostname verified (2026-08-17); phase 3 redirect + www required before indexing; mailbox-domain/copy/OG sub-questions open |

Session 2 (IA + copy skeleton) is **approved** (2026-08-11) with the owner's corrections applied to [04-content-spec.md](04-content-spec.md). Session 3 (wireframes) proceeds on these rulings. Session 10 needs OD-LP-2; Session 12 needs OD-LP-6/7.
