# Children & Guardian — Product Remediation Design

**Session 12 · 2026-08-13 · DESIGN ONLY (not implemented this session).**

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

## 6. Implementation status & effort
**Not implemented in Session 12.** This is a **patient-app engineering task** touching onboarding/auth (age gate), profile creation (dependent + attestation), and the schema (additive fields) — plus tests. Recommended as a dedicated PR before launch. Estimated: small-to-medium (no external identity vendor for V1). Launch-gating (owner ruling #5).
