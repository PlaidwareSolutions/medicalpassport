# Session 12 — Owner Rulings on the Seven Decisions

**2026-08-13.** Authoritative record of the owner's rulings on the decisions surfaced at the end of Session 12. Recorded here (not in `01-decisions.md`, which a concurrent session is editing) — to be merged into the OD-LP register once that edit lands. These are **business/product rulings**; items marked for counsel remain legally pending.

| # | Decision | Ruling | Status after ruling |
|---|---|---|---|
| 1 | Operating legal entity | **OPEN** — owner to supply exact registered entity; prefers an existing suitable Plaidware entity over forming a new company | **BLOCKED** (need name, type, formation state/country, address) |
| 2 | Retention | **Approved V1 policy** (below), subject to counsel | Business-approved; counsel-pending |
| 3 | Erasure | **Approved manual V1 process** before self-service | Process approved; owner + runbook pending |
| 4 | OD-LP-7 contacts | **Google Workspace** (existing), 4 addresses → one monitored inbox, privacy/security distinguishable | **OPEN** — owners unnamed, not provisioned |
| 5 | Children/dependents | **Approved adult-managed-dependent policy**; design now, implement for launch | Policy approved; implementation pending |
| 6 | Business claims | **Adopted 3 bounded commitments** (free / no-ads / no-sale) | Business-approved; publication legal-pending |
| 7 | Counsel | **Engage Indian privacy counsel**; packet + questions defined | Packet assembled; sign-off pending |

---

## 1 — Legal entity (OPEN)
Do **not** infer the entity from "Plaidware Solutions" in Cloudflare/Git. Owner will supply the exact registered legal name, entity type, state/country of formation, and registered/business address. Preference: reuse an existing suitable Plaidware entity rather than forming a new company; if none suitable, formation is the first business blocker. Drafts keep `[LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH]`. **Launch blocker.**

## 2 — Retention (approved V1, counsel to confirm)
| Data | V1 retention |
|---|---|
| Core patient profile + medication/health data | While the account is active |
| Patient documents | While required by the patient/account |
| Verified erasure request | Remove active-system patient data/documents within **30 days** |
| Backups containing deleted data | Naturally expire within **90 days**; no restoration for ordinary business use after deletion except disaster/security/legal necessity |
| Professional leads | **24 months** after last meaningful interaction, then delete unless an active business relationship or legal reason applies |
| Security/audit records (fraud, security, sharing accountability) | **24 months**, unless counsel approves another period |
| Scheduled-dose history | Keep the already-implemented **24 months** unless product/legal review changes it |

Recommended product/business rules, **not** statutory deadlines. Applied to [privacy-data-inventory.md](privacy-data-inventory.md) §8 and the draft Privacy Policy retention section. Note: the 24-month lead and audit rules are **not yet implemented as cron jobs** — they are policy pending an engineering task.

## 3 — Erasure (approved manual V1 process)
Do not delay launch for a polished self-service "Delete my account" UI. V1 operational process:

> privacy request → identity verification → identify the user's account/profile/data → invalidate sessions and active shares → remove eligible active database records and private objects → record completion of the request **without retaining the deleted health content** → allow backups to expire under the approved backup-retention policy.

Then build self-service deletion later. Today there is **neither** a feature **nor** a process — this ruling authorizes the process; it still needs an owner and a written runbook. Applied to [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md) §3.

## 4 — OD-LP-7 contacts (Google Workspace)
Use the **existing Google Workspace**, not Cloudflare Email Routing. Add `medidocs.app` to Workspace and establish `support@ / privacy@ / security@ / partnerships@medidocs.app`, initially routing into one monitored inbox/group, but with privacy and security messages **distinguishable by the address they arrived through**.

Launch requires named: **Primary owner** (owner or named operating owner), **Backup owner** (one named person), **Privacy/grievance owner**, **Security escalation owner** — all currently `OWNER REQUIRED`. **Do not publish any address until it is created and inbound + outbound mail is proven.** OD-LP-7 stays **OPEN**. (Provisioning Workspace/DNS is a launch activity; not performed this session.)

## 5 — Children/dependents (approved policy; design now)
Approved product rule: a person under 18 does not independently establish/manage an adult account; a child's Medicine Passport is established and managed through an adult parent/lawful-guardian workflow. Launch minimum: age determination sufficient to identify <18; clear dependent designation; adult attestation of parent/lawful-guardian status; **no independent child signup path**; no targeted advertising/behavioural tracking of children. Then design proper verifiable parental/guardian consent before the DPDP child provisions commence (14 May 2027). Detailed design: [children-guardian-remediation-design.md](children-guardian-remediation-design.md). **Implementation is a patient-app engineering task, not done in this governance session.**

## 6 — Business claims (3 bounded commitments adopted)
Adopted as **permanent business commitments** (publication still gated on counsel):
1. **Free:** "Medicine Passport is free for patients to create, maintain and access their core Medicine Passport."
2. **Advertising:** "We do not show advertising in the patient Medicine Passport experience."
3. **Sale of health information:** "We do not sell identifiable patient health information." (Chosen deliberately over the broader, over-absolute "we will never sell your data.")

Business gate **APPROVED**; legal/publication gate **pending counsel**. Applied to the draft pages and [privacy-compliance-review.md](privacy-compliance-review.md) §12.

## 7 — Counsel (engage before launch)
Engage Indian privacy counsel now. Packet + questions: [counsel-brief.md](counsel-brief.md). OD-LP-6 stays **APPROVED PROCESS — FINAL SIGN-OFF OPEN** until documented counsel approval.
