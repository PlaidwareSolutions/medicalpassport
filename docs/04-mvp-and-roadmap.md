# 04 — MVP and Roadmap

## MVP definition (Phase 1 PWA)

The MVP is complete when a patient can, from a mobile browser without installing anything:

1. Sign in with mobile number + OTP in their chosen language (en/hi/te/ur).
2. Build a medication passport by search, manual entry, or prescription photo (with human confirmation of every extracted field).
3. See a plain-language medication card for each medicine (common uses vs. their recorded reason, how/when to take, side effects, warnings) with read-aloud.
4. Follow a daily timeline, receive layered reminders, and record taken/skipped/snoozed doses — including offline.
5. See safety findings (duplicates, class overlaps, interactions, allergy/condition/food/alcohol concerns) with safe wording and next steps.
6. Share a doctor-visit summary via QR, time-limited link, PDF, or WhatsApp-friendly text — consented, expirable, revocable, audited.
7. Grant and revoke granular caregiver access.
8. Export data and request deletion.

## Delivery roadmap (implementation stages → releases)

| Release | Stages | Contents | Status |
|---|---|---|---|
| R0 Foundations | 0–1 | Planning docs, monorepo, Railway/Cloudflare foundations, CI, PWA shell | **This session** |
| R1 Passport | 2 | OTP auth, profiles, caregivers, consent, catalog, manual entry, medication list/detail | **This session** |
| R2 Documents | 3 | Private R2, presigned uploads, camera capture, prescription images, cleanup | Planned |
| R3 Reminders | 4 | Schedules, daily timeline, browser notifications, SMS/WhatsApp fallback, missed-dose reconciliation, refill reminders | Planned |
| R4 Offline | 5 | Offline shell + IndexedDB caches, offline dose events, mutation queue, conflict handling | Planned |
| R5 Safety | 6 | Ingredient normalization, duplicate checks, validated interaction integration, allergy checks, findings + review workflow | Planned — gated by [34-clinical-validation-plan](34-clinical-validation-plan.md) |
| R6 Sharing | 7 | Doctor-visit summary, PDF, secure links, QR, WhatsApp summary, revocation, audit | Planned |
| R7 OCR + AI | 8 | OCR pipeline, candidate extraction + confidence + confirmation, approved-content simplification, translation, AI auditing/traceability | Planned |
| R8 Android | 9 | Expo app, native notifications, encrypted storage, background sync, biometrics, Play Store | Deferred to Android phase |
| R9 iOS | 10 | iOS support, accessibility validation, App Store | Deferred to iOS phase |
| R10 Hardening | 11 | Backups + restore tests, WAF/rate-limit/Turnstile verification, security/privacy/accessibility reviews, load tests, cost controls, runbooks, clinical validation gates | Gates production label |

## Success metrics (spec §27)

**Primary MVP metric: patients can safely and easily use the product from a browser.** Never optimize for app installation at the expense of patient access.

### Patient value & safety
- Confirmed medication completeness; medication-list accuracy (vs. pharmacist reconciliation samples)
- Reminder acknowledgement rate; dose-recording rate
- Reduction in unconfirmed entries over time
- Duplicate ingredients identified; safety findings reviewed (by patient and professionally)
- Medication summaries shared; caregiver engagement
- Patient comprehension and patient confidence (surveyed)

### Quality & trust
- OCR correction rate (how often patients fix extracted fields)
- False-positive alert rate; unsupported AI statement rate (target ~0, audited per [19](19-ai-use-and-guardrails.md))

### PWA & platform
- PWA usage without installation; add-to-home-screen rate; browser-notification opt-in
- SMS fallback usage; WhatsApp fallback usage
- Synchronization success; offline mutation success; notification-delivery success

### Operational (dashboards defined in [21](21-observability-and-audit.md))
- R2 processing success; background-job failure rate; API latency; Railway availability
- Backup success; restore success; cost per active patient ([31](31-cost-and-capacity-model.md))

### Native-phase comparators
- Android conversion rate after Phase 2; native reminder reliability compared with PWA reminders

## Out of MVP scope

ABDM/ABHA integration (later interoperability — [17](17-fhir-and-abdm-strategy.md)), FHIR import, pharmacy integrations, e-prescriptions, telemedicine, payments, medication purchasing, native apps.
