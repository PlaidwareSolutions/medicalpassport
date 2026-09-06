# 15 — Release Strategy

Do not wait 12 months to launch "V2". Releases are incremental, feature-flagged (`FeatureFlag` table, per-profile allowlists, percentage rollout), and each maps to phase exits in [06](06-phase-plan.md). Every release passes the gates in [12 §4](12-deployment-and-environments.md) and carries the evidence in [13 §4](13-verification-and-quality.md).

| Release | Name | Contents | Depends on | Flags |
|---|---|---|---|---|
| V2.0 | Core Patient Passport | provenance everywhere; organizations, encounters, clinical profile (conditions with status, allergies with category, immunizations, procedures, family history, emergency contacts, blood group); Health Timeline; prescription line items; medicine why/who/when; refill plan; documents v2 (multi-page, classification confirm, extraction targets for prescriptions); share presets and Doctor Snapshot v1; step-up auth; keyring; lint/OpenAPI/worker tests in CI | M0, M1, M2, M3 (prescription targets), M7 partial | `timeline`, `documents_v2`, `doctor_snapshot` |
| V2.1 | Diagnostics | `DiagnosticReport/Result`, LOINC/UCUM terminology, structured entry, lab-value extraction, trends per analyte | M4 | `diagnostics_v2`, `lab_extraction` |
| V2.2 | Home Health | `Observation` hub (BP, HR, glucose, weight, SpO2, temperature), context, trend analytics, first device connector; V1 readings endpoints read-only | M5 | `observations_v2`, `device_sync` |
| V2.3 | Family | seven new scopes, scope-aware UI, family dashboard, activity attribution, caregiver notification kinds, per-kind controls | M6 | `family_dashboard` |
| V2.4 | ABDM Beta | ABHA link, discovery/link/fetch on sandbox → production credentials pending; FHIR export of own data (IG v6.5); ABDM consent screen; abdm-gateway service; pen test complete; DPO designated | M8A–M8D, pen test, OD-9 | `abha_link`, `abdm_phr`, `fhir_export` |
| V2.5 | Clinical Intelligence | licensed catalog (OD-3) and interaction provider (OD-4) live; multi-prescription and conflicting-instruction checks; Gate 3 dashboard; **sunset migration of V1 tables** after parity | M9, Gates 1–3 | `interactions` (per category) |
| V2.6 | Provider — Clinic Portal | provider-web, QR onboarding, snapshot, reconciliation proposals, prescription capture, encounter proposals, follow-up reminders, patient proposals inbox | M11, Gate 8 | `provider_clinic` |
| V2.7 | Ecosystem | pharmacy dispense/refill, lab levels 2–3, hospital transition record, treatment journey views | M12, M13, M14, M10 | `provider_pharmacy`, `provider_lab`, `hospital_transition`, `journey` |
| V2.8 | ABDM Production | sandbox exit (M8E), production ABDM credentials, HIU flows for the clinic product, lab level 4 | M8E, security assessment | `abdm_production`, `abdm_hiu` |
| V2.9 | Enterprise | organization management, integrations page, analytics for organizations, Indian Patient Summary export, additional locales published | M15, M16 | `ips_export`, per-locale |

## Rules

1. A flag starts at 0 % in production and is widened only after the smoke suite passes and the error budget holds for 7 days at each step (1 % → 10 % → 50 % → 100 %).
2. Pilot cohort profiles are allowlisted on flags ahead of percentage rollout ([17](17-pilot-plan.md)).
3. A release note per version lists: features, migrations run, backfills and parity results, gate evidence, flags, known limitations, rollback plan.
4. V1 endpoints deprecated in [05 §15](05-api-contracts-v2.md) are removed only at V2.5, after the sunset migration, and only if the OpenAPI usage counter shows zero calls for one release.
5. Native Android/iOS (V1 Stages 9/10) remain separate tracks; they consume the same API and flags and are not release prerequisites for V2.x.
6. Copy, locales and guidance audio ship with the feature they describe; a feature is not "done" in a locale it is not published in.
