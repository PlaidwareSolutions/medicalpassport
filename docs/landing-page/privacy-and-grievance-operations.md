# Privacy, Support & Grievance Operations — Medicine Passport by MediDocs

**Session 12 · 2026-08-12 · Operational design (OD-LP-7). Not legal advice.**

Defines how support, privacy requests, grievances, security reports, and professional inquiries are received, owned, tracked, and escalated. Contacts are **designed, not provisioned** — see §1 for the hard blocker.

---

## 1. OD-LP-7 — public contact architecture · **STILL OPEN**

**Verified state (2026-08-12):** the four intended addresses are **NOT provisioned.**
- `dig MX medidocs.app` → **no MX records**; `dig A medidocs.app` → **no apex A record**; no SPF/TXT. The apex is entirely unconfigured (consistent with "not launched").
- Grep of the whole repo → **no `@medidocs.app` address anywhere** (only `support@example.com` placeholder in a VAPID default and test fixtures).

So `support@`, `privacy@`, `security@`, `partnerships@` **@medidocs.app do not work today**. Per SPEC §35/§42 they must **not** appear on the live public site until verified operational.

> **OD-LP-7 — `OPEN — OWNER/ROUTING REQUIRED`.** Missing: (a) a decision to provision the mailboxes/aliases (email infra not to be created without explicit authorization, SPEC §42), (b) named **primary + backup owners**, (c) a tracking mechanism. Naming addresses is not closing OD-LP-7.

### Minimal V1 mailbox model (proposed — needs owner + provisioning)

Four public addresses, **one actively-monitored operational inbox** via aliases/groups. Do not invent people — `OWNER REQUIRED` where unresolved.

| Public address | Purpose | Routing destination | Primary owner | Backup | Tracking | Escalation |
|---|---|---|---|---|---|---|
| `support@medidocs.app` | Account/app help | → shared ops inbox | `OWNER REQUIRED` | `OWNER REQUIRED` | Ticket/reference log | → privacy (if data request) / security (if incident) |
| `privacy@medidocs.app` | Rights & grievance | → shared ops inbox (privacy queue) | `OWNER REQUIRED` (grievance officer) | `OWNER REQUIRED` | Ticket + request register | → counsel / owner |
| `security@medidocs.app` | Vulnerability & incident reports | → shared ops inbox (security queue) | `OWNER REQUIRED` (eng) | `OWNER REQUIRED` | Ticket + incident log | → owner + counsel if personal data affected |
| `partnerships@medidocs.app` | Professional/clinic inquiries | → shared ops inbox → existing lead flow | `OWNER REQUIRED` | `OWNER REQUIRED` | Existing `ProfessionalLead` register | → business owner |

**Provisioning options (owner decides; do not execute in Session 12):** Cloudflare Email Routing (aliases → an existing inbox; lightest, no Workspace) *or* Google Workspace group. Requires apex DNS + MX, which is a launch activity.

### Staging placeholder rule

Until an address is verified operational, the live site shows **no** contact email. Draft legal pages use a visible reviewer placeholder — `[CONTACT: privacy channel — NOT YET PROVISIONED — OD-LP-7]` — never a fake working address (SPEC §42).

---

## 2. Support SOP (V1) — `docs` owner: `OWNER REQUIRED`

Scope: account/login, app navigation, caregiver access, medicine-record issues, reminder issues, sharing, privacy/data requests (hand off to §3), security (hand off to §4), professional inquiries (hand off to lead flow).

Flow: **request received → logged with a reference → categorized → assigned → resolved/escalated → response sent → closure recorded.**

**Hard rule: support MUST NOT give medical advice.** For any clinical question ("should I take this?", "is this dose right?", "can I stop this medicine?"), respond with bounded redirection: *"Medicine Passport can't give medical advice. Please ask your doctor or pharmacist about changing, starting, or stopping any medicine."* Do not create a clinical-support service. Support is **not** a medical-emergency channel (see §5).

---

## 3. Privacy / grievance SOP

Handles: access, correction, erasure, consent withdrawal, complaint/grievance, guardian/dependent requests.

Flow: **intake → create ticket/reference → verify identity appropriately → categorize → assign → investigate → act → communicate outcome → escalate if needed → retain the request record.**

- **Identity verification:** match the request to the account (e.g., OTP to the registered phone) before disclosing or changing data; never over-collect to "verify."
- **Erasure today:** because there is **no account-wide deletion feature** (verified — inventory §7), an erasure request is currently a **manual operational process**: locate the account, soft-delete/purge profile-linked records, remove R2 documents, and record what was done and what is retained for legal/security reasons (audit log is retained by design). **This process and its owner are not yet established → P0/P1 gap.** Do not promise instant or absolute deletion.
- **Backups:** erasure must state that encrypted backups roll off per the (to-be-defined) backup retention window rather than being individually edited.
- **Deadlines:** **do not state statutory response deadlines** — DPDP grievance timelines attach at Phase-3 (14 May 2027) and their exact figures require counsel. The business **may** set internal service targets (e.g., acknowledge within N business days) as a **[BD]** choice, labelled as an internal target, not a legal deadline.

Categories to log: privacy question · access · correction/update · erasure · consent withdrawal · caregiver issue · sharing issue · complaint/grievance · security incident.

---

## 4. Security-report SOP (`security@medidocs.app`)

Flow: **report received → acknowledge → triage severity → assign responsible engineer → preserve evidence → investigate → escalate to privacy/counsel if personal data affected → remediate → communicate appropriately → close + postmortem.**

- Leverages existing substrate: hash-chained `AuditEvent`, `ObjectAccessEvent`, `ShareAccessEvent`, environment separation, encrypted backups.
- **Do NOT advertise** a bug bounty, cash rewards, or a safe-harbor program — none exist/approved (SPEC §39). The page may invite responsible disclosure without promising rewards.
- **Breach notification** (Board + affected individuals, ~72-hour detailed report) is a **Phase-3 (2027)** obligation — design the templates now; do not assert current deadlines (SPEC §26).

Minimal breach workflow: **detection → containment → evidence preservation → severity assessment → affected-data identification → legal/privacy escalation → Board notification where legally required → Data-Principal notification where legally required → remediation → post-incident review.**

---

## 5. Security incident vs. medical emergency (explicit)

- `security@` is for **vulnerabilities, suspected unauthorized access, privacy/security incidents** — never medical situations.
- Support and all channels are **not** a medical-emergency service. No channel or copy may suggest MediDocs can respond to urgent medical situations. Emergency copy on public pages directs users to local emergency services / their clinician.

---

## 6. Partnerships / professional inquiries

`partnerships@medidocs.app` aligns with the **existing** professional lead workflow (`ProfessionalLead`, `/for-clinics/` form). Email inquiries received outside the form are **routed into the same operational follow-up** (logged, triaged via the lead register). **Do not** create a second lead database or a CRM in Session 12 (SPEC §41).

---

## 7. What this unblocks / still blocks

- **Unblocked (design done):** routing model, SOP shapes, escalation paths, the placeholder rule for the site.
- **Still blocked (owner/provisioning):** the actual mailboxes/aliases, apex DNS+MX (launch activity), named primary/backup owners, a grievance officer, and a chosen tracking tool. These keep **OD-LP-7 OPEN** and are launch gates.
