# Retention & Erasure — V1 (Session 12.5)

**2026-08-13 · BUSINESS POLICY APPROVED — COUNSEL REVIEW PENDING.** Not legal advice. These are business operating targets, **not** statements that Indian law imposes these exact deadlines.

## 1. Retention policy (V1, approved)

| Data category | V1 retention |
|---|---|
| Core patient account / profile / health data | Retain while the account is active and necessary to provide Medicine Passport. On verified erasure, target removal from active production systems **within 30 days**, subject to legitimate legal/security retention. |
| Patient documents | Retain while the account is active and the patient keeps them. On verified erasure, remove the eligible private objects as part of the same process. |
| Scheduled-dose history | **24 months** (matches the implemented cron), unless changed by product/legal review. |
| Professional leads | **24 months after the last meaningful interaction**, unless an active commercial relationship exists, legal/accounting requires longer, or the person requests deletion. |
| Security / audit records | Target **24 months** where reasonably necessary for security, fraud/abuse, sharing accountability, and incident investigation. Do not delete where doing so compromises a legitimate security/audit obligation. |
| Backups | Deleted active data may remain in encrypted backups until normal expiry; V1 target maximum persistence after deletion **90 days**. Backups are **not** restored into active use to resurrect erased data. |

"30 days" and "90 days" are **business operating targets**, not a claim that a universal statutory deadline exists. Counsel to confirm.

## 2. Reconciliation — policy vs. implementation

| Data category | Approved policy | Current implementation | Gap | Remediation |
|---|---|---|---|---|
| Core health data | Active-account; 30-day erasure removal | Persists while active; **manual erasure mechanism now implemented** (`apps/api/src/ops/account-erasure.ts`) | 30-day *automation* on request is operational, not scheduled | Run the erasure tool per SOP on a verified request |
| Patient documents | Removed on erasure | Erasure deletes `PrescriptionDocument` + private R2 object (best-effort) | Orphaned-object sweep already exists (abandoned-uploads job) | None for V1 |
| Scheduled doses | 24 months | `retention-cleanup` cron deletes > 24 mo | **None** | — |
| Professional leads | 24 months after last interaction | **`cleanup-professional-leads` cron implemented (Session 17)** — deletes where `lastInteractionAt` < now − 24 calendar months (UTC), batched + idempotent + dry-run | Implemented + unit-tested; migration adds `last_interaction_at` (existing rows backfilled to `created_at`). Scheduled cron **service** created on next IaC apply | Truthful-basis note below |
| Security/audit | 24 months | Append-only, **no purge**; hash-chained integrity | Purge not implemented; chain integrity complicates deletion | Design a chain-safe purge with counsel before enforcing |
| Backups | ≤90 days post-deletion | Daily encrypted `pg_dump` → R2 **+ R2 lifecycle rule `expire-postgres-backups` (90-day expiry, `postgres/` prefix) — TECHNICALLY ENFORCED + remotely verified on the prod backups bucket (Session 17)** | Enforced; idempotent `ensure-backup-lifecycle` cron keeps it in place. `verify-backups`/`restore-test` use the latest backup only, so 90-day expiry is safe | None |
| OTP / sessions / uploads | (operational) | 30d / 30d / 7d crons | **None** | — |

**No destructive cleanup of real staging/production data was performed this session.** The lead-retention and backup-purge jobs are policy pending a small, separate engineering task.

## Session 17 — retention enforcement (engineering)

Both retention gaps flagged in Session 16 are now closed at the engineering level:

- **Backups (90-day): TECHNICALLY ENFORCED + VERIFIED.** An R2 lifecycle rule (`expire-postgres-backups`, prefix `postgres/`, `Expiration.Days = 90`, `Status = Enabled`) was applied to the production `…-backups` bucket via the established `railway run` R2-ops path and confirmed by an independent re-read. Applying it deleted nothing (oldest backup was ~21 days old); the earliest expiry is ~90 days out. R2's default multipart-abort rule was preserved (merge, never clobber). An idempotent `ensure-backup-lifecycle` cron (in `railway.ts`/`railway.prod.ts`) re-asserts the rule on schedule and self-heals if removed. Deletion by an R2 lifecycle rule is **asynchronous after the age threshold** (not exact-to-the-minute).

- **Professional leads (24 months): implemented truthfully + tested.** Basis field `lastInteractionAt` (calendar-month, UTC). **Truthful-basis note (§67):** V1 has no follow-up-recording interface, so the only interaction currently recorded is submission — in practice retention is *24 months from submission* until an operational workflow updates `lastInteractionAt` (the column and cron already support that when such a workflow exists). No public endpoint can reset retention age. NULL `lastInteractionAt` is never deleted (fail-safe). The public "24 months after the last meaningful interaction" wording remains accurate as the field is wired for it; if governance prefers a plainer statement, "24 months from submission" is the current engineering-truthful equivalent.

**Rollback notes.** Removing the R2 lifecycle rule stops *future* expiry but **cannot restore already-expired objects** — verification before activation is why we dry-ran first. The lead cleanup is careful deterministic deletion (batched, dry-run, null-safe) protected by the daily backups; no soft-delete layer was added (none is needed for V1).

## 3. Erasure — V1 (manual, executable)

**Ruling:** manual operational erasure for V1; self-service "Delete account" UI later. But there is now an **actual, executable mechanism**, not just a promise.

- **Mechanism:** `AccountErasure` (`apps/api/src/ops/account-erasure.ts`) with a CLI (`apps/api/src/ops/erase-account.cli.ts`). Two phases: `plan()` (dry run — **counts only**, never medicine names / health content) and `execute()` (irreversible). Tested against synthetic data (`apps/api/test/erase-account.e2e-spec.ts`, 3 cases pass).
- **Safety:** dry run is the default; deletion requires `--execute`; in production `--execute` also requires `--i-understand-production`; plans print counts, never health content.
- **Covers (erased):** account (`User`), owned profiles + all their health data (medicines, doses, allergies/conditions/vitals/reports), private documents + the R2 objects behind them, shares (packages/links/access events, incl. the hashed token material), caregiver relationships (on the user's profiles and the user's own access to others'), sessions, devices, push channels, OTP attempts.
- **Legitimately retained:** the hash-chained `audit_events` integrity log (digests/coarse context only, **no raw PHI**), plus one `account.erased` completion record holding **counts only** — verified by test that it contains no medicine/allergy names.

### Identity-verification boundary (§9)
The tool is an internal execution mechanism only. **Before** an operator runs it, the privacy SOP requires appropriate identity verification for the current phone/OTP account model — e.g., confirm the request originates from, or is validated against, the account's registered phone (an OTP challenge to that number), and log the verification in the request record. Do **not** erase an account merely because an email arrived from an arbitrary address. This is not a heavyweight KYC system; it is proportionate to a phone-first account.

### Sequence (§10)
privacy request received → **identity verified** → request approved/assigned (ticket) → **dry run** generated (counts) → active shares revoked & sessions invalidated (part of execute) → private document objects identified → eligible active DB records erased → private objects erased → **minimal completion record retained (counts only)** → requester notified → backups expire naturally within the ≤90-day window.

### Limitations (honest — §11)
- Downloaded share **PDFs cannot be recalled**; copies already retained by a recipient cannot be erased remotely.
- Encrypted **backups** expire on their own bounded schedule (≤90-day target); they are not edited row-by-row.
- Records required for **security/legal** obligations may be retained where justified — but **not** patient health content under an "audit" label (the completion record is counts only).
- **Claimed** profiles (owned by another account) are **detached**, not deleted — a documented V1 limitation; erasing a subject's data that another account owns is a more complex case for later.
- These exceptions are **not** a reason to keep the active patient record indefinitely — the active record is erased.

## 4. Launch status
Erasure moves from *no capability* to **operational process + executable, tested mechanism**. Remaining before it is fully "closed": a named operator + written runbook step in the SOP, and (nice-to-have) the lead-retention/backup-purge jobs. See [launch-governance-checklist.md](launch-governance-checklist.md).
