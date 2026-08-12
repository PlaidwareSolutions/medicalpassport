# Legal Counsel Review Packet — Medicine Passport by MediDocs

**Session 12.5 · 2026-08-13.** An **index/brief** for qualified Indian privacy/legal counsel — not duplicate copies. Prepared by product/engineering; not itself legal advice. Counsel sign-off gates production launch (OD-LP-6).

## How to read this packet
Each item is labelled: **[E] engineering fact** (verified in code) · **[B] business policy** (owner-approved, needs legal review) · **[L] legal question** (counsel to determine).

## Documents (in review order)
1. [privacy-data-inventory.md](privacy-data-inventory.md) — **[E]** every personal-data element, processors, storage, retention, security, consent, rights, children.
2. [privacy-compliance-review.md](privacy-compliance-review.md) — DPDP Act/Rules analysis incl. the **corrected §2 commencement mapping** (Rule 1(2)); role classification; gaps; claims gating.
3. Draft **Privacy Policy** — https://staging.medidocs.app/privacy/ (staging, noindexed; DRAFT).
4. Draft **Terms of Use** — https://staging.medidocs.app/terms/ (staging, noindexed; DRAFT).
5. [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md) — support/privacy/security operations, OD-LP-7 contact model + Workspace admin steps.
6. [retention-and-erasure.md](retention-and-erasure.md) — **[B]** V1 retention schedule + reconciliation; **[E]** executable manual erasure (dry-run/execute, tested).
7. [children-guardian-remediation-design.md](children-guardian-remediation-design.md) — **[B/E]** adult-managed-dependent policy + shipped V1 attestation; future verifiable-consent **[L]**.
8. [legal-entity-decision.md](legal-entity-decision.md) — **[B]** unresolved operating entity (P0 blocker), Telangana/India.
9. [stage7-sharing-security-review.md](stage7-sharing-security-review.md) — **[E]** sharing security review (PASS).
10. [launch-governance-checklist.md](launch-governance-checklist.md) — the controlling gate list.

## Focused questions for counsel
1. Confirm the **DPDP Act/Rules commencement mapping** (Rule 1(2): immediate = Rules 1,2,17–21; one year = Rule 4; eighteen months = Rules 3,5–16,22,23; SDF Rule 12 and cross-border Rule 15 both in the eighteen-month group). **[L]**
2. Confirm MediDocs's likely **legal role / Data Fiduciary** classification and whether SDF designation is a live risk. **[L]**
3. Confirm **current SPDI/IT-Act obligations** applicable *before* the substantive DPDP provisions commence. **[L]**
4. Review the **notice/consent architecture** (in-app consent ledger; standalone-notice adequacy). **[L]**
5. Review the **child/dependent/guardian** design (18+ self attestation; guardian attestation) and the future verifiable-consent method. **[L]**
6. Review the **manual erasure** process (identity verification, 30-day active removal, retained counts-only audit). **[L]**
7. Review the **retention periods** (active-account; 24-mo doses/leads/audit; 90-day backup). **[L]**
8. Review the **backup-deletion** language ("expires within ~90 days; not restored to resurrect erased data"). **[L]**
9. Review the **cross-border processing** position (Railway/Cloudflare-R2/Telnyx locations unverified). **[L]**
10. Review **vendor/DPA** requirements for the confirmed processors. **[L]**
11. Review the **privacy/grievance channel** wording and any officer/response-time requirement (we avoid "DPO"/"Grievance Officer" titles pending designation). **[L]**
12. Review **breach-response** requirements and the ~72-hour Board notification design. **[L]**
13. Review the three business statements: **free for patients** (core), **no ads in the patient experience**, **no sale of identifiable patient health information**. **[B→L]**
14. Review **Terms** liability/disclaimer language (medical + emergency disclaimers). **[L]**
15. Select/confirm **governing law and venue** (intended jurisdiction: Telangana, India). **[L]**
16. Confirm whether current functionality (incl. safety-finding surfacing) triggers any **medical-device/telemedicine** issue. **[L]**

## Blocking item
The **operating legal entity is unresolved** (P0). Privacy Policy/Terms cannot be finalized and the production build guard cannot pass until it is supplied — see [legal-entity-decision.md](legal-entity-decision.md).
