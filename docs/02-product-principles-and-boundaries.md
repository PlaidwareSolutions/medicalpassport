# 02 — Product Principles and Boundaries

## Positioning

The product **is**: a patient-held medication passport, medication education assistant, and medication-safety companion.

The product **is not**, and must never be positioned, marketed, or implemented as:

- An AI doctor
- A diagnostic system
- A prescribing system
- A medication-substitution system
- A clinical decision replacement
- A replacement for a doctor or pharmacist
- A system that independently tells a patient to start medication
- A system that independently tells a patient to stop medication
- A system that independently changes a dose
- A system that declares a prescription safe
- A system that guarantees that no interaction exists

## Clinical-warning contract

Every clinical warning shown to a patient must communicate all four of:

1. **The concern may be intentional** — "This may have been prescribed intentionally."
2. **More information may be needed.**
3. **Do not change medication independently** — "Do not stop or change your medicine based only on this alert."
4. **A doctor or pharmacist should review the concern.**

Approved wording patterns: "Possible duplicate ingredient", "Please confirm with your doctor or pharmacist". When reliable data is unavailable: *"Reliable medication-safety information is not available for this medicine. Please confirm with a doctor or pharmacist."* Never fabricate.

## Non-negotiable rules (spec §30)

These are release gates, restated verbatim in the [production readiness checklist](29-production-readiness-checklist.md):

1. The MVP patient application is a mobile-first Progressive Web Application.
2. Patients must not be required to download an app from an app store.
3. The PWA must work as a normal mobile website; add-to-home-screen is optional.
4. Android is a later phase; iOS is a later phase; native applications use the same backend and clinical services.
5. PostgreSQL on Railway is the authoritative system of record.
6. Clinical rules execute on Railway — never in a browser, service worker, native client, or Cloudflare Worker.
7. Cloudflare is the public edge and private object-storage layer; patient R2 buckets remain private.
8. Sensitive responses are never publicly cached.
9. PostgreSQL and Redis remain private; application containers do not retain permanent files.
10. Every sensitive file access is authorized and audited; every clinical finding is traceable.
11. AI does not invent clinical facts.
12. Development and staging never contain real production patient data.
13. Backups are not valid until restoration is tested.
14. Browser limitations must have documented fallbacks; reminders must not depend only on browser notifications.
15. SMS, WhatsApp, and caregiver fallbacks require explicit consent.
16. No separate clinical logic in the PWA or native applications.
17. The system is not labeled production-ready without clinical, privacy, security, accessibility, backup, and operational validation.

## Design principles

1. **Comprehension first.** Plain language at roughly a 5th-grade reading level in every supported language; icons with labels; audio playback; progressive disclosure ("Explain simply" → "Tell me more" → "Show clinical details").
2. **Never silently interpret.** Ambiguous prescription abbreviations (OD, BD, TDS, 1-0-1, SOS, HS…) are shown with the detected value, proposed plain-language interpretation, and confidence; they require explicit confirmation; original and confirmed values are both preserved with who/when, and remain correctable ([spec §6 rules → 09-clinical-safety-strategy](09-clinical-safety-strategy.md)).
3. **Common use ≠ patient's reason.** "This medicine is commonly used for" and "Your recorded prescription says it was prescribed for" are separate fields, separate UI, separate provenance. The patient-specific reason is never inferred from common indications.
4. **Consent is a feature, not a checkbox.** Every access, delegated permission, export, and share is consent-driven, patient-specific, purpose-bound, revocable, time-bound where appropriate, and auditable.
5. **Honest system state.** Reminders are tracked queued→sent→delivered→acknowledged; a scheduled job is never assumed delivered. Sync status (online/offline/syncing/failed/pending/last-synced) is always visible.
6. **Deterministic safety, generative explanation.** Validated structured data decides *whether* to warn; AI only rephrases, translates, and explains approved content ([19-ai-use-and-guardrails](19-ai-use-and-guardrails.md)).
7. **Not a hospital EMR.** The patient interface prioritizes today's doses and comprehension, not clinical density.
8. **Privacy by default.** No health information in URLs, logs, analytics, object keys, or notifications (reminder wording is privacy-safe unless the patient opts into medication names).

## Agent/engineering behavior principles (spec §29)

- Plan before code; restate assumptions; identify clinical and privacy risks.
- When uncertain: state the uncertainty, document the assumption in [24-open-decisions-and-assumptions](24-open-decisions-and-assumptions.md), choose the safest reasonable option, do not invent clinical facts, do not block all progress unnecessarily.
- Track every work item with the status categories: Completed, In progress, Blocked, Mocked, Requires clinical validation, Requires security review, Requires platform configuration, Deferred to Android phase, Deferred to iOS phase ([22-implementation-plan](22-implementation-plan.md)).
- Do not weaken clinical safety to reduce cost ([31-cost-and-capacity-model](31-cost-and-capacity-model.md)).
