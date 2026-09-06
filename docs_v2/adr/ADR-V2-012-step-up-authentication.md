# ADR-V2-012 — Step-up authentication for sensitive operations

Status: Accepted (owner directive 2026-09-06: "complete whole v2, don't wait for permissions") · Date: 2026-09-06 · Deciders: Privacy & Security Board, Architecture Board

## Context
Roadmap §28 requires step-up authentication for caregiver management, sharing, account recovery, data export and account deletion. V1 sessions last 12 h (30 d refresh) and trusted-device login skips OTP entirely, so a left-open phone can create a share or invite a caregiver.

## Decision
Add `Session.stepUpVerifiedAt`. `POST auth/step-up` re-runs OTP for patients (voice/SMS/log transport), TOTP for admins and provider users. A `@RequiresStepUp()` guard on the endpoints listed in [11 §7](../11-security-privacy-compliance.md) returns `403 step_up_required` when the stamp is older than 10 minutes. patient-web shows an inline re-verify sheet and retries the action.

## Consequences
- Some friction on rare, high-impact actions; none on daily use.
- Real OTP cost per step-up; trusted-device login is unaffected for ordinary use.

## Alternatives considered
Shorter sessions — rejected: friction on daily use. Device biometrics — deferred to native phases (WebAuthn considered for V2.3 as an alternative step-up method).

## Verification
e2e per guarded endpoint: 403 without step-up, success within 10 min, 403 after expiry; audit action `auth.step_up_verified`.
