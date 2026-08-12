# Counsel Brief — Medicine Passport by MediDocs

**Session 12 · 2026-08-13.** Packet and questions for qualified Indian privacy/legal counsel (owner ruling #7). Purpose: obtain the review and sign-off that gates production launch (OD-LP-6). This brief is prepared by the product/engineering team and is not itself legal advice.

## Packet (share these, in this order)
1. [privacy-data-inventory.md](privacy-data-inventory.md) — engineering-verified inventory of all personal data, processors, retention, security, consent, rights, children.
2. [privacy-compliance-review.md](privacy-compliance-review.md) — DPDP Act 2023 + Rules 2025 phasing analysis, role classification, notice, breach, gap register, claims gating.
3. Draft **Privacy Policy** — https://staging.medidocs.app/privacy/ (staging, noindexed; DRAFT).
4. Draft **Terms of Use** — https://staging.medidocs.app/terms/ (staging, noindexed; DRAFT).
5. [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md) — support/privacy/grievance/security operations (OD-LP-7).
6. [launch-governance-checklist.md](launch-governance-checklist.md) — pre-launch gate list.
7. [stage7-sharing-security-review.md](stage7-sharing-security-review.md) — sharing security review (PASS).
8. Supporting: [session12-owner-rulings.md](session12-owner-rulings.md), [children-guardian-remediation-design.md](children-guardian-remediation-design.md).

## Specific questions for counsel
1. **DPDP commencement:** confirm the phased-commencement analysis (Rules 2025, G.S.R. 846(E), 14 Nov 2025; Phase-3 ~14 May 2027) and which obligations apply to MediDocs *now* vs. as proactive readiness.
2. **Current SPDI/IT-Act obligations:** confirm what the IT Act 2000 + SPDI Rules 2011 require of a health-record service **today** (privacy policy, consent, reasonable security), independent of DPDP phasing.
3. **Entity / role:** confirm MediDocs's role as **Data Fiduciary** and whether any government designation (e.g., Significant Data Fiduciary) is triggered; confirm the operating entity to name.
4. **Child/guardian design:** confirm whether the adult-managed-dependent V1 (age gate + guardian attestation) is adequate before 14 May 2027, and what "verifiable" consent will require thereafter.
5. **Cross-border processing:** advise on lawful processing given unverified Railway/Cloudflare-R2/Telnyx locations and any localization expectation for health data.
6. **Retention/erasure:** confirm the approved V1 retention schedule and the manual erasure process, including audit/backup carve-outs.
7. **Notice/consent wording:** confirm the standalone-notice and consent-withdrawal approach and required content.
8. **Grievance contact:** confirm grievance/redressal contact and any officer/response-time requirements.
9. **Terms:** confirm liability limitations, medical/emergency disclaimers, governing law and venue.

## What counsel sign-off unlocks
Removing the `DRAFT — LEGAL REVIEW REQUIRED` banner and the reviewer placeholders, and clearing OD-LP-6 — a hard prerequisite for a production build (enforced by `scripts/check-legal-placeholders.mjs`).
