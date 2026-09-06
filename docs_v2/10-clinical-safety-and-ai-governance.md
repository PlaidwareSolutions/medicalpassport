# 10 — Clinical Safety and AI Governance

Extends `docs/09` (safety strategy), `docs/10` (hazard log, 28 entries), `docs/19` (AI guardrails) and `docs/34` (validation gates). Nothing in those documents is relaxed.

## 1. Classification of functionality (roadmap §29)

Every user-visible clinical feature is classified before build, recorded in its work package, and reviewed by the Clinical Safety Board.

| Class | Definition | Example | V2 ships? |
|---|---|---|---|
| Information | approved content about a medicine or test | "Metformin is commonly used for type 2 diabetes." | yes (maker-checker content, exists) |
| Observation | a factual statement about the patient's own data using thresholds the patient or a provider configured | "Seven of your last ten BP measurements exceeded the range set in your profile." | yes, thresholds are never system defaults for clinical decisions |
| Safety flag | a deterministic finding with explanation and the four-statement contract | "These medicines appear to contain the same active ingredient." | yes |
| Medical recommendation | tells the patient what to do clinically | "You should stop Medicine B." | **no** |

Lint: copy keys under `safety.*`, `insights.*`, `trends.*` are checked against a deny-list of imperative clinical verbs ("stop", "start", "increase", "reduce", "take" outside schedule context) in all locales; failures block CI; exceptions require a Safety Board note in the key's comment.

## 2. Clinical Safety Board

Members (minimum): physician adviser, pharmacist, product representative, safety/compliance representative. Chair: clinical lead (resolves OD-6; nothing patient-visible clinical ships until appointed). Meets fortnightly; emergency review within 48 h for a P1/P2 incident. Decisions recorded in `docs_v2/validation/safety-board/YYYY-MM-DD.md`.

Owns: rule approval and versions, alert wording in every locale, hazard log sign-off, Gate 1–6 sign-off, threshold policies for Observations, notification escalation rules (roadmap §15 "clinical escalation rules must be carefully validated").

## 3. Safety engine (Phase 2/9)

- Engine moves to `packages/clinical-rules` (from `apps/api/src/modules/safety/safety-rules.ts`) with identical behaviour proven by copying the golden tests first.
- Rules are versioned constants (`ruleKey@version`); every finding records source/source version/rule version/app version/evaluation time/inputs (V1 traceability kept).
- Categories: exact duplication, partial duplication in a combination, therapeutic-class duplication, multi-prescription overlap (new), conflicting instructions (new), drug-allergy, uncertain normalization, schedule conflict, dose differs from prescription, drug-drug interaction (OD-4), drug-condition (OD-4), food, alcohol (OD-4), missing information.
- Explainability contract: every finding has `explanation` (why, naming the entities), `evidence` (ids of the rows involved), and the four statements. UI renders; never computes.
- Re-evaluation triggers extend to: prescription item started, reconciliation accepted, dispense accepted, ABDM import confirmed, condition added/changed (for drug-condition when licensed).

## 4. Validation gates (extends `docs/34`)

| Gate | Scope | V2 addition |
|---|---|---|
| 1 | catalog/normalization ≥ 200 products, ≥ 50 FDCs, ≥ 98 % resolution | licensed catalog (OD-3) |
| 1b | analyte vocabulary | LOINC/UCUM mapping review; unit conversions |
| 2 | golden clinical set (16 cases) | + reconciliation cases, + multi-prescription cases, + provider-proposal cases |
| 3 | alert quality, continuous | admin dashboard for FP rate and acknowledgement; alert-fatigue review monthly |
| 4 | comprehension ≥ 12 participants, ≥ 80 % | + caregiver flows, + Doctor Snapshot comprehension with ≥ 6 clinicians (Gate 4b), + "relationship not cause" copy |
| 5 | OCR confirmation flow | + classification, + lab values, + handwriting/Indic corpus, + dose-proposal threshold evidence |
| 6 | AI outputs | + prompt injection via document content, + extraction hallucination rate |
| **7 (new)** | FHIR/ABDM conformance | every supported artifact validates; import never bypasses confirmation |
| **8 (new)** | Provider workflows | reconciliation proposals cannot mutate the patient record without acceptance; audit completeness for provider reads |

A release is blocked if any gate regresses. Evidence lives under `docs_v2/validation/`.

## 5. Hazard log additions (H-29 …)

| ID | Hazard | Severity/likelihood | Mitigation | Phase |
|---|---|---|---|---|
| H-29 | Timeline shows events out of clinical order because `occurredAt` was taken from upload time | Moderate/Medium | `documentDate`/`testedAt` precedence rules; badge "date from upload" when unknown | P1 |
| H-30 | Patient-entered value shown with a "verified" badge | Major/Low | provenance state machine; badge from `verification` only; test asserts no UI path maps `patient_confirmed` to verified copy | P1 |
| H-31 | Result linked to the wrong encounter | Moderate/Medium | encounter linking is explicit and editable; timeline shows encounter chips | P1 |
| H-32 | Family history recorded on the wrong profile in a caregiver account | Major/Low | profile-keyed content (V1 pattern) + confirmation banner naming the profile | P1 |
| H-33 | Timeline exposes caregiver-only actions to a share recipient | Major/Low | `HealthEvent` excluded from shares unless section chosen; caregiver actions never in Doctor Snapshot | P7 |
| H-34 | Discharge summary misclassified as prescription → stopped medicines proposed as current | Catastrophic/Medium | kind confirmation before extraction; discharge summaries route to the transition workflow, never to "add medicines" | P3/P14 |
| H-35 | Lab unit mis-parsed (mg/dL vs mmol/L) | Major/Medium | unit is a separate candidate with its own confirmation; canonical unit shown; conversion never silent | P4 |
| H-36 | Candidate attached to wrong report in a multi-document upload | Moderate/Medium | one document per flow; page grouping confirmed | P3 |
| H-37 | AI extractor hallucinates a medicine | Catastrophic/Low | schema-constrained output; every candidate must cite a bounding box whose OCR text fuzzy-matches the proposal, else dropped; Gate 6 | P3 |
| H-38 | Share-target ingests another person's document | Major/Low | profile picker on ingest; nothing auto-attached | P3 |
| H-39 | Trend chart mixes units or profiles | Major/Low | series keyed by unit; profile-keyed | P4/P5 |
| H-40 | Device sync duplicates or back-dates observations | Moderate/Medium | dedupe key; device provenance; sync log | P5 |
| H-41 | Caregiver "unusual measurement" alert with an unvalidated threshold | Major/Medium | alert only behind Safety-Board-approved rule; patient-configured range otherwise; wording is Observation class | P6 |
| H-42 | Provider proposal applied without patient acceptance | Catastrophic/Low | ADR-V2-009; tests assert proposals cannot write clinical tables | P11 |
| H-43 | Reconciliation STOP line accepted by mistake | Major/Medium | per-line confirmation with medicine name and reason; undo window via `MedicationChange` | P11/P14 |
| H-44 | ABDM-imported record accepted without review and conflicts with current list | Major/Medium | import via candidates; safety re-evaluation on confirm | P8 |
| H-45 | FHIR export omits a stopped medicine and a clinician assumes it is current | Major/Low | export includes status; conformance tests cover status map | P8 |
| H-46 | Voice entry mis-hears "15" as "50" | Catastrophic/Medium | confirmation screen shows the parsed number in large type and speaks it back before save | P16 |
| H-47 | Translation of a safety flag changes meaning in a new locale | Major/Medium | H-19 process per locale; back-translation review at Gate 4 | P16 |
| H-48 | Notification overload causes reminders to be muted | Major/High | per-kind caps, digest mode, never mute `dose_reminder` by system action | P17 |
| H-49 | Break-glass admin access to clinical data without justification | Major/Low | reason required, time-boxed, patient notified, weekly review | P0 |
| H-50 | Data erase on ABDM consent expiry removes patient-confirmed records | Major/Low | erase only bundle copies; legal position confirmed (D-ABDM-2) | P8 |

## 6. AI governance (summary; details in [09](09-document-intelligence.md) §8)

Allowed uses: OCR, classification, extraction, terminology mapping suggestions, voice entry, summarization of approved content. Not allowed: generating clinical facts, changing authoritative data, producing recommendations. Required: confidence → confirmation → record; model provenance stored; Gate 6 on every model/prompt change; contractual no-training terms (OD-12); documents treated as untrusted input.

## 7. Information vs advice in copy

All patient-facing clinical copy carries its class in the localization key namespace (`info.*`, `observation.*`, `safety.*`). Marketing and help copy is reviewed under H-27. The four-statement contract remains on every safety flag.
