# Privacy, Support & Grievance Operations — Medicine Passport by MediDocs

**Session 12 · 2026-08-12 · Operational design (OD-LP-7). Not legal advice.**

Defines how support, privacy requests, grievances, security reports, and professional inquiries are received, owned, tracked, and escalated. Contacts are **designed, not provisioned** — see §1 for the hard blocker.

---

## 1. OD-LP-7 — public contact architecture · **STILL OPEN** (owners set; provisioning pending)

**Verified state (2026-08-13):** the four intended addresses are **NOT provisioned.**
- `dig MX medidocs.app` → **no MX records**; `dig A medidocs.app` → **no apex A record**; no SPF/TXT. The apex is entirely unconfigured.
- No Google Workspace admin tooling or credentials are available to this session (no `gcloud`, no GAM, no service-account creds), so provisioning **cannot** be done automatically here.

So `support@`, `privacy@`, `security@`, `partnerships@` **@medidocs.app do not work today**. They must **not** appear on the live public site until verified operational (SPEC §35/§42).

> **`EMAIL PROVISIONING — MANUAL ADMIN ACTION REQUIRED`.** Per SPEC §17, provisioning is not fabricated; the exact admin steps are below. **OD-LP-7 remains `OPEN`** until all four addresses have working routing, a primary owner, a backup, tracking, and **verified test delivery** (SPEC §19).

### Ownership + routing model (owner ruling)

| Public address | Purpose | Routes to (primary) | Backup / continuity | Tracking | Escalation |
|---|---|---|---|---|---|
| `support@medidocs.app` | Account/app help | **solutions@plaidware.com** | **kfnawaz@gmail.com** | Ticket/reference log | → privacy (data request) / security (incident) |
| `privacy@medidocs.app` | Rights & grievance | **solutions@plaidware.com** | **kfnawaz@gmail.com** | Request register | → counsel / owner |
| `security@medidocs.app` | Vulnerability & incident | **solutions@plaidware.com** | **kfnawaz@gmail.com** | Incident log | → owner + counsel if personal data affected |
| `partnerships@medidocs.app` | Professional/clinic inquiries | **solutions@plaidware.com** → existing lead flow | **kfnawaz@gmail.com** | Existing `ProfessionalLead` register | → business owner |

Privacy and security messages must stay **distinguishable by the address they arrived through**, even if all route to one monitored inbox. The backup personal address (`kfnawaz@gmail.com`) is for **continuity/escalation only** and must **not** be exposed publicly.

### Preferred implementation — Google Workspace (manual admin steps)

Use the **existing Google Workspace** (not Cloudflare Email Routing — do not switch platforms without approval). Steps for a Workspace admin:
1. **Add + verify the domain** `medidocs.app` in Workspace (Admin console → Domains → Add a domain, as a secondary domain or domain alias as appropriate) via the TXT verification record.
2. **Publish MX** for `medidocs.app` pointing to Google (`smtp.google.com`, or the standard Google MX set), plus **SPF** (`v=spf1 include:_spdf.google.com ~all` / Google's current include) and **DKIM** + **DMARC** records.
3. **Create the four addresses** as **Groups** (recommended — gives routing + membership + audit) or user aliases:
   `support@`, `privacy@`, `security@`, `partnerships@medidocs.app`.
4. **Routing:** add `solutions@plaidware.com` as the primary member/owner of each group; add `kfnawaz@gmail.com` as a backup member for continuity/escalation.
5. **Keep queues distinguishable** (separate groups, or labels/filters keyed on the To: address).
6. Confirm outbound replies can be sent **as** the public address without exposing internal addresses.

*(Apex DNS/MX for `medidocs.app` is itself a launch activity — see the production-provisioning gate.)*

### Verification before an address is launch-ready (SPEC §18) — do for each of the four
1. inbound message from an external account is received by the primary owner;
2. backup/escalation behaves as configured;
3. a reply can be sent as the public address without exposing internal addresses;
4. no bounce; 5. no mail loop.
Record results (no patient content). Only after this may staging show the address.

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
- **Erasure — approved manual V1 process (owner ruling #3):** because there is **no account-wide deletion feature** (verified — inventory §7), an erasure request is fulfilled by this operational process:
  1. privacy request received → **verify identity** (e.g., OTP to the registered phone);
  2. identify the user's account/profile/data;
  3. **invalidate sessions and active shares**;
  4. remove eligible **active** database records and private R2 objects;
  5. **record completion of the request without retaining the deleted health content**;
  6. allow backups to **expire under the ~90-day backup policy** (no restore for ordinary use post-deletion).
  Active-system removal targets **within 30 days**. Self-service deletion is a later build. **Still needed: a named owner and a written runbook.** Do not promise instant or absolute deletion.
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
- **Still blocked (owner/provisioning):** the actual mailboxes/aliases and apex DNS+MX (manual admin action / launch activity), and a chosen tracking tool. Owners are set (primary `solutions@plaidware.com`, backup `kfnawaz@gmail.com`). These keep **OD-LP-7 OPEN** and are launch gates.

> **Titles (SPEC §20):** do not label anyone "Data Protection Officer" or "Grievance Officer" unless the business formally designates that role. Until then use **"privacy/grievance contact"** in public-facing wording (counsel-reviewed). The erasure mechanism referenced in §3 is documented in [retention-and-erasure.md](retention-and-erasure.md) (§3 — identity-verification boundary + sequence).
