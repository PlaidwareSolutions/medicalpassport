# 00 — V2 Charter

Supersedes the scope statement in `docs/00-product-vision.md` and `docs/04-mvp-and-roadmap.md`. Product principles in `docs/02` remain in force unchanged and are extended in §5.

## 1. Vision

MedicinePassport V2 evolves from a medication-management application into a **patient-controlled longitudinal health passport** centred on medications, with the clinical information needed to understand the patient's health journey.

The promise:

> One reliable health passport for my medicines, prescriptions, test results and everyday health measurements — controlled by me and shareable with my doctors and family when I choose.

The distinguishing capability stays **medication intelligence and medication reconciliation**. V2 is not a generic document locker.

## 2. What V2 must become the record of

Current and historical medicines · prescriptions · schedules and adherence · allergies · conditions · laboratory results · diagnostic and imaging reports · in-home measurements · medical documents · doctors and facilities · medication changes · clinical events · caregiver activity · consent and sharing history.

V1 already holds the first four and parts of the next six (see [01](01-current-state-baseline.md)). V2 completes the list and connects everything through one timeline.

## 3. Strategic objectives and how each is verified

| Objective | Outcome statement | Verifiable by |
|---|---|---|
| O1 Trustworthy longitudinal record | One timeline connecting medicines, prescriptions, labs, measurements, conditions, documents | `HealthEvent` projection exists for every clinical table; the timeline e2e reconstructs a synthetic 24-month history in order |
| O2 Authoritative medication record | What, why, who prescribed, when started, dose changes, when stopped, duplicates, interactions | Medication history endpoint returns every `MedicationChange`; reconciliation golden set passes; interaction checks light up only after OD-4 |
| O3 No manual document management | Photo/upload → classify → extract → confirm → structured record, original preserved | Gate 5 corpus: zero paths where an unconfirmed extraction becomes a confirmed record; original object retained for every document |
| O4 Everyday monitoring | BP, glucose, weight, pulse, SpO2, temperature and more, with context | `Observation` concepts implemented with unit enforcement; trend endpoints tested per concept |
| O5 Families and caregivers | Multiple members, granular permissions, no shared passwords | Exhaustive scope × action authorization matrix test; caregiver audit visible to the patient |
| O6 Usable during care | Concise clinician views and doctor summaries | Doctor Snapshot renders in under 2 s for a 500-event profile; clinician comprehension study ≥ 80 % (Gate 4b) |
| O7 ABDM interoperability | ABHA identity, discovery/link/fetch, consent-controlled exchange, FHIR R4 | Sandbox exit artifacts complete (M8E); FHIR conformance suite green for every supported artifact |
| O8 Provider channels | Clinics, hospitals, labs, pharmacies onboard and interact | Pilot: ≥2 clinics, ≥1 pharmacy, ≥1 lab live with real workflows |
| O9 Clinical safety and privacy built in | Information vs advice separated; source, provenance, confidence preserved | Provenance columns NOT NULL on every clinical table; every safety finding explains itself; DPDP capabilities in §5 of [11](11-security-privacy-compliance.md) implemented |
| O10 Free for patients, B2B revenue | Monetization via organizational products, integrations and services | No patient feature behind a paywall; provider products have an organization billing boundary |

## 4. Planning horizon

12–15 months to scaled V2, releasing continuously from month 3 (see [15-release-strategy.md](15-release-strategy.md)). Dates in this set are relative to a **Phase 0 start of 2026-09-08** and move with capacity. Dependencies matter more than dates ([16](16-dependencies-and-risks.md)).

## 5. Boundaries (V1 `docs/02` rules, plus V2 additions)

Still true: MedicinePassport is not an AI doctor, not a diagnostic or prescribing system, not a substitution system, and never independently tells a patient to start, stop or change a medicine. Every warning carries the four-statement contract.

V2 additions:

1. **Provenance is never laundered.** Patient-entered or OCR-extracted data is never displayed, exported or exchanged as provider-authenticated.
2. **AI never writes authoritative clinical data.** AI result → confidence → user/provider confirmation → structured record. Model provenance is stored for medically significant extraction.
3. **Providers propose, patients accept.** Clinic and pharmacy products create proposals (reconciliation lines, dispense records, medication-change proposals); the patient's record changes only on patient or authorized-caregiver acceptance, except for records the provider itself authenticates (a lab's own result) which land as `source_authenticated` but still enter the passport through the confirmation queue.
4. **ABDM consent and MedicinePassport sharing consent are separate objects.** They are never equated in code, UI or copy.
5. **Interpretation comes from labs, providers or clinically approved rules — never client code.** No "high"/"low" badge is computed in the PWA.
6. **Explainable warnings only.** "Possible duplicate ingredient: Glimepiride appears in Medicine A and Medicine B" is allowed. "You should stop Medicine B" is not.
7. **Functionality is classified** as Information, Observation, Safety flag, or Medical recommendation ([10](10-clinical-safety-and-ai-governance.md)). V2 ships the first three only.

## 6. Explicitly not V2 core

Full hospital EMR · insurance claims · online pharmacy marketplace · diagnostic marketplace · telemedicine marketplace · autonomous AI diagnosis · autonomous medication changes · wellness/fitness social platform. NHCX, UHI and similar can follow when a business case exists.

## 7. Conceptual architecture

```
                    MEDICINEPASSPORT
                          │
                   Patient Identity
          ┌───────────────┼───────────────┐
        ABHA          MP Identity      Caregivers
                          │
                 Patient Health Record
   ┌──────────┬───────────┼────────────┬───────────┐
Medicines Prescriptions  Tests   Measurements  Documents
   └──────────┴───────────┼────────────┴───────────┘
                    Health Timeline
                          │
                Conditions / Allergies
                          │
                 Clinical Relationships
                          │
                  Sharing & Consent
          ┌───────────────┼───────────────┐
        Doctor         Caregiver          ABDM
          │                                 │
   Clinic / Hospital              HIE-CM / HIP / HIU
                                            │
                                         FHIR R4
```

The database stays product-shaped. Four layers sit between it and the outside world: an internal canonical clinical model ([04](04-canonical-clinical-model.md)), a versioned terminology layer, a FHIR transformation/conformance service, and ABDM integration adapters ([03](03-target-architecture.md), [08](08-abdm-fhir-integration.md)).

## 8. How the roadmap maps onto this repository

| Roadmap phase | Repo areas that change | V2 doc |
|---|---|---|
| 0 Foundation | `docs_v2/`, `packages/domain` (provenance), CI, ADRs | [19](19-phase-0-execution-checklist.md) |
| 1 Core PHR | `packages/database` (organizations, encounters, health events, provenance), `apps/api` profiles/timeline, patient-web timeline | [06](06-phase-plan.md) §P1 |
| 2 Medication | `apps/api/modules/medications`, `prescriptions`, `safety`; `packages/medication-terminology` | §P2 |
| 3 Documents/AI | `apps/worker` extraction, `packages/object-storage`, new `packages/document-intelligence` | [09](09-document-intelligence.md) |
| 4 Tests | `DiagnosticReport`/`DiagnosticResult`, reports module, trends | §P4 |
| 5 Measurements | `Observation`, vitals module, `MeasurementDevice` | §P5 |
| 6 Caregivers | scopes, notifications, family dashboard | §P6 |
| 7 Sharing | sharing module, Doctor Snapshot, presets | §P7 |
| 8 ABDM | new `packages/fhir`, `packages/terminology`, `apps/api/modules/abdm`, `apps/abdm-gateway` (adapter service) | [08](08-abdm-fhir-integration.md) |
| 9 Clinical intelligence | `safety` engine, licensed data adapters | [10](10-clinical-safety-and-ai-governance.md) |
| 10 Treatment journey | relationship engine over `HealthEvent` | §P10 |
| 11 Clinic | new `apps/provider-web`, `ProviderPatientLink`, reconciliation | §P11 |
| 12 Pharmacy | `MedicationDispense`, refill plans, provider-web pharmacy mode | §P12 |
| 13 Labs | lab import levels 1–4 | §P13 |
| 14 Hospital discharge | transition record over reconciliation + encounters | §P14 |
| 15 Indian Patient Summary | FHIR layer v7.x mapping | [08](08-abdm-fhir-integration.md) §8 |
| 16 Multilingual/voice | `packages/localization` (6 new locales), voice entry with confirmation | §P16 |
| 17 Notifications | notification kinds, frequency controls | §P17 |
