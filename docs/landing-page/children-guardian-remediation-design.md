# Children & Guardian — Product Remediation Design + V1 Status

**Session 12 design; V1 shipped after Session 12. · Updated 2026-08-13.**

> **PRODUCT POLICY APPROVED — COUNSEL REVIEW PENDING.** Working launch policy: a person under 18 does not independently establish/manage Medicine Passport as an adult account holder; a child's Medicine Passport is managed through an adult parent/lawful-guardian relationship. Generic caregiver access is **not** equated with lawful guardianship. Counsel to review; verifiable parental consent (DPDP Rule 10, ~14 May 2027) is future work (§ below).

Implements owner ruling #5 ([session12-owner-rulings.md](session12-owner-rulings.md)): a person under 18 does not run their own adult account; a child's Medicine Passport is set up and managed by an adult parent/lawful guardian. Grounded in the real data model (`User`, `PatientProfile.yearOfBirth`, `PatientProfile.dependentRelationship`, `CaregiverRelationship`). Not legal advice.

## 1. Current behavior (verified gap)
- Accounts are created by phone + OTP; **no age is captured at signup**.
- `PatientProfile` stores `yearOfBirth` (year only) and free-text `dependentRelationship`; the app **does not** determine whether a subject is a child, **does not** verify guardian status, and **does not** distinguish a product "caregiver" from a **lawful guardian**.
- There is no block on a person under 18 creating their own account.

## 2. Launch-minimum design (V1)
| Requirement | Design |
|---|---|
| **Age determination (self)** | At account onboarding, capture the account holder's year of birth (or an "I am 18 or older" attestation). Enough to identify a self-account holder who is under 18. |
| **No independent child signup** | If the account holder indicates <18, do **not** create an adult self-account. Show a message: a child's Medicine Passport must be set up by a parent or lawful guardian, and offer the guardian path. |
| **Dependent designation** | When an adult adds a profile for someone else, keep the existing dependent flow but make "this profile is a dependent / child I care for" an explicit, stored designation (already partly modeled via `dependentRelationship`). |
| **Guardian attestation** | When an adult creates/manages a **child** dependent (subject <18 by `yearOfBirth`), require an explicit attestation: "I am the parent or lawful guardian of this person and consent to keeping their medicine information." Store the attestation (who, when, version). |
| **No child tracking/ads** | Already consistent with product philosophy (no ad system; marketing analytics never runs in the patient app or on share pages). Make it an explicit invariant in code review. |

## 3. Data-model changes (proposed, additive)
- `PatientProfile`: add a nullable `guardianAttestation` block (or a small `GuardianAttestation` row): `{ attestedByUserId, attestedAt, attestationVersion }`. Additive; no migration risk to existing rows.
- `User`: add optional `selfBirthYear` **or** a boolean `ageConfirmedAdult` captured at onboarding (minimize — a boolean may be enough for the self-account gate). [BD] pick one.
- No new PHI beyond a year/boolean + an attestation record.

## 4. Future — verifiable parental/guardian consent (Phase-3 readiness)
DPDP (from 14 May 2027) requires **verifiable** parental/lawful-guardian consent for under-18s. Attestation alone is likely insufficient. Options to design (counsel to steer): consent tied to a verified adult identity signal already in the system (the guardian's own OTP-verified phone) plus a durable consent record; or an out-of-band verification step. Do **not** build a heavy identity-verification system now — design and stage it against the 14 May 2027 date.

## 5. Boundaries
- **Caregiver ≠ lawful guardian.** The attestation captures the guardian claim explicitly; the generic caregiver-invite flow stays as-is for adult-to-adult delegation.
- Keep it minimal and honest — the draft Privacy Policy/Terms state the *intended* adult-managed policy; do not claim enforcement the code does not yet do until V1 ships.

## 6. Implementation status — **V1 SHIPPED** (PR #1, merged to `foundation`, deployed staging + prod)

The launch-minimum V1 (§2) is implemented and live:
- **Self profile requires year of birth and blocks under-18** → `403 self_account_minor` (an under-18 cannot run their own adult account). `apps/api/src/modules/profiles/profiles.controller.ts` + `createSelfProfileSchema`.
- **Guardian attestation required for a child dependent** (relationship `child`, or birth year <18) → `400 guardian_attestation_required`; stores `guardianAttestedByUserId/_At/_Version`. Migration `20260813120000` (additive).
- **No independent child signup path**; dependent designation retained; **no targeted advertising / behavioural tracking of children** (consistent with product philosophy — no ad system; marketing analytics never runs in the patient app).
- Client: onboarding requires a valid birth year; add-dependent shows a required parent/guardian attestation checkbox for children.
- Tests: 10 e2e cases pass against a real DB (7 children-guardian + 3 updated); typecheck/build green.

Domain helper `isMinorByBirthYear` uses **year-only** granularity (a documented approximation).

## 7. Future — verifiable parental/guardian consent (DPDP Rule 10, ~14 May 2027)
The V1 **attestation checkbox does not, by itself, satisfy** the future DPDP requirement for *verifiable* parental/lawful-guardian consent. Counsel + product must determine the eventual verification method (e.g., tying consent to a verified adult identity signal already in the system, or an out-of-band step) **before** Rule 10 commences. Do **not** claim the checkbox is verifiable consent. Do not build a national identity/KYC service now.
