# 17 — Pilot Plan (months 12–13)

Do not launch every institutional capability nationally at once. Start with a controlled ecosystem, observe workflows directly, and measure against explicit criteria.

## 1. Composition (roadmap §42)

| Participant | Count | Recruited by | Prerequisite |
|---|---|---|---|
| Clinics | 2–3 | WS17 | V2.6 clinic portal on production behind `provider_clinic`; org verified in admin |
| Pharmacies | 1–2 | WS17 | V2.7 pharmacy mode |
| Laboratory partner | 1 | WS17 | lab level 2 or 3 integration live |
| Patients | 100–300, elderly / chronic-care cohort (diabetes, hypertension, thyroid, cardiac) | via clinics | onboarded with the QR flow; consent notice version recorded |
| Family caregivers | ≥ 40 | via patients | caregiver invitations with scopes |
| Devices | ≥ 20 patients with a BP monitor/glucometer | pharmacies | manual entry fallback |

Geography: one metro, two languages (English plus one of Hindi/Telugu/Urdu depending on the partners), so H-19 review load is bounded.

## 2. What the pilot tests

onboarding · prescription scanning (printed and handwritten) · medication reconciliation at a clinic visit · lab ingestion · BP/glucose tracking with context · caregiver management · QR doctor sharing and Doctor Snapshot · ABHA linking and record fetch (if V2.8 credentials exist; otherwise sandbox-only demonstration outside the pilot cohort).

## 3. Protocol

1. Governance gate: D-LEGAL resolved (entity, counsel sign-off, DPO, support channel, erasure operator); privacy notice final; pilot consent addendum reviewed by counsel; Clinical Safety Board pre-pilot review.
2. Training: one session per clinic/pharmacy/lab with the provider-web sandbox on staging and synthetic patients; a printed one-page patient onboarding card in each language.
3. Enrollment: 4 weeks, capped at 300; every patient's first session observed for ≥ 30 patients (WS02 field notes).
4. Operation: 8 weeks; weekly Safety Board review of findings, alerts and support cases; on-call active; error budget monitored.
5. Data: production data stays in production; analysis via the PHI-free metrics pipeline plus clinic-side interviews; no exports of clinical data for research.
6. Exit: success criteria scored; hazard log updated; go/no-go for Scale.

## 4. Success criteria (roadmap §43) and measures

| Criterion | Measure | Target |
|---|---|---|
| Patients maintain their passport without expert help | proportion of enrolled patients with ≥ 1 self-entered record/week in weeks 5–8 | ≥ 60 % |
| Elderly patients complete essential workflows | task completion in observed sessions (add medicine, mark dose, share QR) among ≥ 60-year-olds | ≥ 80 % |
| Caregivers manage family members safely | zero wrong-profile incidents; caregiver actions attributed correctly in 100 % of sampled audits | 0 / 100 % |
| Doctors understand the snapshot quickly | clinician time-to-comprehension in observed visits; Gate 4b survey | median < 60 s; ≥ 80 % "sufficient" |
| Prescriptions convert accurately | field-level agreement between confirmed values and a clinician re-read on a sample of 100 prescriptions | ≥ 95 % printed; handwritten reported separately |
| Test results normalize and trend correctly | sample of 100 results checked for analyte/unit/value correctness | ≥ 98 % |
| Measurements carry context | proportion of observations with context set | ≥ 90 % |
| ABDM records link/fetch/share | if in scope: successful consent flows | ≥ 90 % of attempts |
| Clinical safety warnings useful without unacceptable false positives | Gate 3 metrics from the cohort | FP rate trending down; no unmitigated Catastrophic/High hazard |
| Reliability | dose-reminder delivery success; API error rate | ≥ 99 % / < 0.5 % |

## 5. Scale (months 12–15, V2.9)

Widen flags by percentage, add clinics/pharmacies per city with the same onboarding kit, publish additional locales as native review completes, add device partners, and move to the enterprise features (organization management, integrations, analytics). ABDM production pilot (M15) runs with the same cohort once credentials exist.
