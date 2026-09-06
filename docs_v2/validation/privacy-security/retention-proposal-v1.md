# Retention table proposal for counsel (OD-7, draft v1)

Status: 2026-09-06 draft. This is the engineering proposal behind docs_v2/11 §6, written so counsel can answer each row with "agree", "change to …", or "needs a legal basis we do not have". Where a cron already enforces a window, that is stated; where it does not, the row says what would be built once the window is decided.

Terms: **online** = readable by the product; **archive** = encrypted export in R2, readable only by an operator with the archive key; **delete** = irrecoverable except from backups, which themselves age out in 90 days.

| # | Class | Proposed online | Archive | Delete trigger | Enforced today | Rationale / question for counsel |
|---|---|---|---|---|---|---|
| 1 | Clinical records (medications, conditions, observations, reports, immunizations, procedures, family history, encounters) | life of account | none | erase request; account inactive N years (N to decide) | erase cascade exists; no inactivity rule | A longitudinal record is the product; the patient chooses when it ends. Question: is an inactivity deletion required, and with what notice? |
| 2 | Documents (originals in R2) and derived pages/text | life of account | none | erase request or document delete; quarantined files deleted after 30 days | delete on erase/document delete exists; quarantine purge to build | Keep the original because the extracted text is not authoritative. Question: any duty to retain a prescription image after the patient deletes it? Engineering says no. |
| 3 | Dose events | 24 months | monthly aggregates kept | age | cron exists | Adherence beyond two years is not clinically used; aggregates keep trends. |
| 4 | Audit events | 24 months | monthly encrypted export ≥ 7 years | never before 7 years | chain and nightly verify exist; archive export to build | Seven years mirrors common medical-record retention and supports breach investigation. Question: confirm the floor. |
| 5 | Object and share access events | 24 months | with audit archive | age | to build | Patients see who opened a share; investigators need it longer. |
| 6 | Operational logs and traces | 90 days | none | age | vendor setting (OD-13) | Logs are PHI-free by policy; 90 days covers incident review. |
| 7 | OTP attempts, sessions, rate buckets, device tokens | hours to 30 days | none | age; revoke | crons exist | Security data only. |
| 8 | Consent records, notices, consent events | life of account + 7 years | with audit archive | never before 7 years after erase | erase keeps a tombstone; to formalise | Proof that consent existed must outlive the data it covered. Question: confirm. |
| 9 | ABDM data bundles (copies received under consent) | until the artefact's `dataEraseAt` | none | timer | cron exists | ABDM rule; the patient's own confirmed rows (class 1) remain theirs. |
| 10 | ABDM consent artefacts and transactions | 7 years | none | age | to build | Same reasoning as row 8; ABDM audit expectations. |
| 11 | Provider proposals | accepted/rejected: 12 months; pending: 90 days then expired | none | age | expiry to build | A proposal is a message, not a record; the accepted content lives in class 1 with provenance. |
| 12 | Provider-patient links | until revoked, then 7 years as an audit fact | with audit archive | age | revoke exists | Who could see what, and when, is an audit question. |
| 13 | Safety findings and actions | life of account | none | erase request | none needed | Part of the clinical record; also the Gate 3 quality evidence. |
| 14 | Product events (analytics) | 13 months | none | age | to build | One year plus a month for year-over-year comparison; keyed by a peppered hash so erasure of the profile leaves no link. Question: is hashing with a pepper sufficient anonymisation for the DPDP Rules, or must rows be deleted on erase? |
| 15 | Backups | 90 days | none | lifecycle rule | exists | Restore point objective; erased data can therefore reappear in a restore for up to 90 days — disclosed in the notice. |
| 16 | Support cases and notes | 24 months after close | none | age | to build | Grievance handling evidence. Question: DPDP grievance retention expectations. |
| 17 | Break-glass grants | 7 years | with audit archive | age | none needed | Admin access to clinical data must remain reviewable. |
| 18 | Professional leads (marketing) | 24 months since last interaction | none | age | cron exists | V1 rule, unchanged. |
| 19 | Admin users and sessions | life of employment; sessions days | none | offboarding | manual | Access review quarterly (docs_v2/11 §8). |

## Notes for counsel

- Erasure is a cascade in code (`erase-account`): rows in classes 1, 2, 3, 13 are deleted, relationships and links are revoked and kept as audit facts, consent leaves a tombstone, and R2 objects are deleted with proof in the job log. The 90-day backup window is the only place erased data survives.
- Nothing in this table is enforced against **audit** data by the erasure flow, by design: an erasure request itself becomes an audit event.
- Where a row says "to build", the cron is a one-shot in `apps/cron` of the same shape as the existing ones; each is a small ticket once the window is agreed.

## Decision record

| Row | Counsel decision | Date | Engineering ticket |
|---|---|---|---|
| | | | |
