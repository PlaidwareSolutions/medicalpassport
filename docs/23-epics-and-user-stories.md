# 23 — Epics and User Stories

Story format: *As a 〈persona〉 I want 〈capability〉 so that 〈outcome〉* + acceptance criteria (AC). Personas from [01](01-personas-and-jobs.md). Stories map to stages in [22](22-implementation-plan.md).

## E1 — Identity & onboarding (Stage 2)
- **E1.1** As a patient I want to sign in with my mobile number and OTP so that I don't need passwords. AC: enumeration-safe; attempt/resend limits; lockout messaging; works in all four locales.
- **E1.2** As a patient I want to choose my language first so that I understand everything after. AC: persists pre/post auth; RTL Urdu.
- **E1.3** As a patient I want a minimal profile so that I can start fast. AC: ≤10 taps; optional fields skippable.
- **E1.4** As a user I want to see and revoke my sessions so that a lost phone isn't a breach. AC: revoked session fails next request; local data purged on next open.

## E2 — Medication passport (Stage 2)
- **E2.1** As a patient I want to add a medicine by searching its brand so that I don't type details. AC: brand/generic/ingredient search incl. aliases; select strength/form; <1 s on 3G.
- **E2.2** As a patient I want manual entry with pickers so that unlisted medicines still work. AC: all §6 dosage patterns; typed units; no free-text dose.
- **E2.3** As a patient I want current vs previous medicines separated so that my list is trustworthy. AC: status transitions validated; history preserved; change log visible.
- **E2.4** As a patient I want to record why each medicine was prescribed to me so that doctors understand my treatment. AC: patient-reason separate from common uses; never auto-filled.
- **E2.5** As a patient I want each mutation audited so that I can see who changed what. AC: audit events on create/edit/status change with actor.

## E3 — Caregivers & consent (Stage 2)
- **E3.1** As a caregiver I want dependent profiles so that I can manage my parents' medicines. AC: profile switcher; full-management scope; claimable later.
- **E3.2** As a patient I want granular caregiver permissions so that help doesn't mean surrender. AC: 10 scopes; server-enforced; revocation immediate (403 within seconds).
- **E3.3** As a patient I want to see every caregiver access so that trust is verifiable. AC: patient-visible access log.
- **E3.4** As a patient I want consent for every channel and share so that nothing happens silently. AC: consent records with purpose; revocation cascades.

## E4 — Documents & capture (Stage 3)
- **E4.1** As a patient I want to photograph my prescription so that I don't type it. AC: camera + upload fallback; direct-to-R2 presigned; verified server-side; lost-connectivity resume.
- **E4.2** As a patient I want my images kept private so that my health stays mine. AC: private buckets, opaque keys, short-lived URLs, access audited.
- **E4.3** As an operator I want abandoned uploads cleaned so that storage doesn't rot. AC: lifecycle cron; orphan reconciliation.

## E5 — Scheduling & reminders (Stage 4)
- **E5.1** As a patient I want a meal-anchored daily timeline so that I know what's due. AC: slots morning→bedtime + custom; all 7 §14.4 dose actions.
- **E5.2** As a patient I want reminders that reach me even without browser push so that I don't miss doses. AC: layered channels; consented SMS/WhatsApp; delivery states tracked; never assumed delivered.
- **E5.3** As a patient I want privacy-safe reminder wording so that my lock screen reveals nothing. AC: default generic; full names opt-in only.
- **E5.4** As a patient I want refill and course-completion warnings so that I don't run out mid-course. AC: estimates labeled; antibiotics completion distinct.
- **E5.5** As a caregiver I want escalation when doses go unacknowledged so that I can step in. AC: consented; quiet-hours policy; audited.

## E6 — Offline (Stage 5)
- **E6.1** As a patient with patchy network I want today's schedule offline so that connectivity never blocks care. AC: cached meds + schedule render offline.
- **E6.2** As a patient I want offline dose recording so that facts aren't lost. AC: idempotent queue; exactly-once server apply; never silently dropped.
- **E6.3** As a patient I want honest sync status so that I know where my data is. AC: six states + last-synced; per-item failure detail.

## E7 — Safety review (Stage 6)
- **E7.1** As a patient I want duplicate-ingredient warnings across brands so that I don't double-dose. AC: categories 1–3; four mandatory statements; evidence + rule version shown.
- **E7.2** As a patient I want interaction/allergy/condition/food/alcohol concerns flagged so that I can ask my doctor. AC: validated sources only; fallback string when data missing.
- **E7.3** As a patient I want findings to persist until reviewed so that warnings aren't lost. AC: acknowledge ≠ delete; high-severity stays visible.
- **E7.4** As a clinical admin I want every finding traceable so that we can answer "why did it warn". AC: source/version/rule/app/time/input persisted immutably.

## E8 — Sharing (Stage 7)
- **E8.1** As a patient I want doctor-visit mode so that appointments start informed. AC: §14.6 contents; works offline; readable at arm's length.
- **E8.2** As a patient I want QR/link/PDF/WhatsApp sharing with expiry and revocation so that I control my record. AC: selective sections; no-store; access log visible; revoke <5 s.
- **E8.3** As a doctor I want the shared view organized clinically so that review takes <30 s. AC: ingredients, doses, changes, concerns prioritized.

## E9 — OCR & AI (Stage 8)
- **E9.1** As a patient I want extracted fields with confidence and confirmation so that machine errors can't hurt me. AC: §6 ten-step protocol; originals immutable; low-confidence gating.
- **E9.2** As a patient I want explanations simplified and translated so that I truly understand. AC: grounded in approved content; provenance label; fallback string; zero fabrication (Gate 6).
- **E9.3** As an auditor I want every AI execution recorded so that outputs are accountable. AC: provider/model/digests/consent per execution.

## E10 — Admin & clinical governance (Stages 2–8)
- **E10.1** As an admin I want catalog + mapping management with maker-checker so that patient safety data is reviewed. AC: maker ≠ checker; versioned; audited.
- **E10.2** As a reviewer I want translation and content review queues so that nothing unreviewed reaches patients. AC: approved-only publication; review dates tracked.
- **E10.3** As support I want incident and audit tools so that problems are investigated properly. AC: audited admin access.

## E11 — Data rights (Stages 2/7)
- **E11.1** As a patient I want a full export so that my data is portable. AC: async; PDF + FHIR bundle; short-lived link; re-auth.
- **E11.2** As a patient I want account deletion with a grace period so that leaving is real but safe. AC: coordinated PG+R2+shares deletion; retention disclosures.

## E12 — Platform & operations (Stages 1/11)
- **E12.1** As an operator I want health endpoints, structured logs, correlation IDs, and metrics so that production is observable. AC: [21](21-observability-and-audit.md).
- **E12.2** As an operator I want idempotent jobs with DLQ and replay so that failures are recoverable. AC: worker/cron test cases in [20](20-testing-strategy.md).
- **E12.3** As an operator I want tested backups so that disaster is survivable. AC: restore test green ([27](27-backup-and-disaster-recovery.md)).
