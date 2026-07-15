# 00 — Product Vision

## One-line vision

A patient-held **medication passport, medication education assistant, and medication-safety companion** for patients in India — usable from any mobile browser, with no app-store installation required.

## The problem

Patients in India commonly:

- Collect prescriptions from multiple doctors who do not see each other's records.
- Receive the **same active ingredient under different brand names** and take it twice.
- Cannot read handwritten prescriptions or English-language medication instructions.
- Rely on family caregivers who have no structured view of what a parent or dependent takes.
- Miss doses because nothing reminds them, and cannot tell a new doctor what they take.
- Use older, low-storage Android devices with intermittent connectivity, where installing another app is a real barrier.

There is no widely-adopted, patient-owned, multilingual record of "what medicines am I taking, why, and how" that travels with the patient across doctors, pharmacies, and hospitals.

## What we are building

A **mobile-first Progressive Web Application** (Phase 1), later joined by native Android (Phase 2) and iOS (Phase 3) apps that share the same backend, domain model, clinical-safety services, authentication, and sync architecture.

The product helps patients and caregivers:

1. Maintain an accurate list of current and previous medications.
2. Understand what each medication is commonly used for, and why it was prescribed *to them* (kept strictly separate).
3. Know quantity, timing, frequency, duration, and food instructions in plain language and their own language.
4. Receive layered reminders (in-app, browser push, SMS, WhatsApp, caregiver) and record doses.
5. See possible duplicate ingredients, same-class overlaps, and potential drug-drug / drug-allergy / drug-condition / food / alcohol concerns from **validated structured clinical data**.
6. Share an accurate, consented, revocable medication summary with doctors, pharmacists, hospitals, and caregivers.

## What we are explicitly not

Per [02-product-principles-and-boundaries](02-product-principles-and-boundaries.md), this is **not** an AI doctor, diagnostic system, prescribing system, substitution engine, or replacement for clinical judgment. It surfaces *possible concerns* and always routes clinical decisions to a doctor or pharmacist. It never independently tells a patient to start, stop, or change a medication, and never declares a prescription "safe".

## Who it serves

Primary: adults managing their own medicines (including older adults, patients with multiple chronic conditions and 5+ medicines, recently discharged patients, patients with limited English or limited reading ability) and **caregivers** managing parents and dependents. Secondary: doctors and pharmacists reviewing a patient-provided list, and clinical administrators maintaining approved content. See [01-personas-and-jobs](01-personas-and-jobs.md).

## Why a PWA first

- **Zero-install access**: works from a shared link or QR code in any modern mobile browser; installation is optional, never required.
- **Low-end device reality**: no storage cost, no Play Store friction, instant updates.
- **One codebase for patient + caregiver**, role-aware at the same URL.
- Native apps come later for stronger reminders, biometrics, and background sync — against the **same** APIs and clinical services ([03-client-delivery-and-phased-rollout](03-client-delivery-and-phased-rollout.md)).

## Where it runs

- **Railway**: all application compute and data — API (NestJS), web apps (Next.js), workers, cron, PostgreSQL (system of record), Redis (queues/coordination only).
- **Cloudflare**: public edge — DNS, TLS, proxy, WAF, rate limiting, Turnstile, CDN for public static assets — and **private R2** object storage for prescription images, documents, exports, and backups.

No other cloud provider is introduced without a documented, approved exception ([24-open-decisions-and-assumptions](24-open-decisions-and-assumptions.md)).

## Success

The **primary MVP success metric is whether patients can safely and easily use the product from a browser** — never optimize for app installation at the expense of patient access. Full metric definitions (medication-list accuracy, reminder acknowledgement, duplicate ingredients identified, OCR correction rate, false-positive alert rate, sync success, cost per active patient, and more) live in [04-mvp-and-roadmap](04-mvp-and-roadmap.md) and [21-observability-and-audit](21-observability-and-audit.md).

## Guiding values

1. **Patient comprehension over feature count** — plain language, large text, audio, four launch languages (English, Hindi, Telugu, Urdu), extensible to more.
2. **Safety through humility** — every warning says the concern may be intentional, and points to a professional.
3. **Consent everywhere** — every access, delegation, export, and share is consent-driven, purpose-bound, revocable, and audited.
4. **Truthful engineering** — no fabricated clinical facts, no unverified reminders marked delivered, no backups trusted until restore-tested.
