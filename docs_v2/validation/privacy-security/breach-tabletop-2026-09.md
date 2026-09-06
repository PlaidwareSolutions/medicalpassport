# Breach tabletop exercise — scenario pack (September 2026)

Status: pack written 2026-09-06; the exercise has not been run. Ticket 0.26 closes when the log at the end has one completed session. Runs in 90 minutes with the product owner, the engineering lead, whoever holds the Railway and Cloudflare accounts, and counsel or the DPO if available. No system is touched during the exercise; every "action" is spoken and written down.

## Ground rules

- The facilitator reads one inject at a time; the team says what they would do, who does it, and how long it takes.
- Every decision is written into the log with a clock time from the scenario, not the real clock.
- The 72-hour question is asked explicitly at every inject: "Is this a personal-data breach we are aware of? If yes, when did the clock start?" Engineering's reading of the DPDP Rules is that notification of the Board and affected individuals is required without undue delay once the fiduciary becomes aware; counsel confirms the exact obligation.
- Existing runbooks are used as written (docs/30 R7 suspected breach, R8 leaked secret, R10 bad deploy, R13 Cloudflare misconfiguration; docs_v2/runbooks R-KEY-1, R-DR-3). Gaps found become tickets, not blame.

## Scenario A — leaked share links

**Inject 1 (T+0):** A patient writes to support: a WhatsApp group of forty people has a link to her lab reports. She shared it with one doctor three days ago.

Questions: how do we find the share (`ShareLink`, `ShareAccessEvent`)? What do the access events show (count, IPs, user agents, times)? Can we revoke it now, and who can? What do we tell her, and in which language?

**Inject 2 (T+20 min):** Access events show 31 opens from 19 distinct addresses over two days.

Questions: is this a breach by the fiduciary or misuse by the recipient? Does the 72-hour clock start? Who decides? What does the patient notification contain? Is the audit trail preserved before anything is changed?

**Inject 3 (T+2 h):** A journalist asks whether MedicinePassport "leaks medical reports".

Questions: who speaks; what is the factual statement; what must not be said before counsel reviews.

Expected controls to surface: share revocation, access events visible to the patient, expiry defaults, the open product question of a view cap (DPIA R4).

## Scenario B — leaked Railway token

**Inject 1 (T+0):** GitHub secret scanning e-mails the owner: a Railway account token was found in a public gist.

Questions: which token (dev, prod, account-level)? Runbook R8: rotate first or assess first? How do we list what the token could do (`.railway/*.ts` scope, variables readable)? Are database credentials readable through it? Are backups?

**Inject 2 (T+30 min):** Railway's audit log shows a `variables list` call on the production api service from an unknown address twelve hours ago.

Questions: `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, `SHARE_TOKEN_PEPPER`, `SESSION_TOKEN_PEPPER` were readable. Which of R-KEY-1 (key rotation), session revocation, pepper rotation, database credential rotation happen, in what order, and what breaks for patients during each? Does the 72-hour clock start now or at the first e-mail?

**Inject 3 (T+4 h):** Database logs show no connection from outside the private network.

Questions: is "no evidence of access" enough to say no breach occurred? What evidence would be needed? What is recorded in the incident record and the hazard log?

Expected controls to surface: private networking (the URL alone does not reach Postgres from outside), field encryption limiting what a dump exposes, keyring rotation, audit chain as evidence, `checkSuites` and IaC plan as the deploy path an attacker would need.

## Scenario C — insider break-glass

**Inject 1 (T+0):** The nightly audit review shows one admin used `privileged_record_access` on nine profiles in one evening, each with the reason "support ticket".

Questions: is that a policy breach, a data breach, or neither until proven? What does `BreakGlassGrant` record? Were the nine patients notified in-app as designed? Who reviews (R-BG-1, to write)?

**Inject 2 (T+1 h):** Support has tickets for two of the nine profiles; none for the other seven.

Questions: suspend the admin? Preserve evidence how? Is each of the seven a notifiable breach? What do those patients receive, and who signs it?

Expected controls to surface: break-glass reason and time-box, patient notification, audit search duty separation, the missing R-BG-1 runbook.

## Scenario D — wrong reminder content after a deploy

**Inject 1 (T+0):** Ten minutes after a deploy, three patients report reminders naming a medicine they do not take.

Questions: this is a patient-safety incident first (R11 clinical error) and a possible confidentiality incident second (whose medicine is it?). Rollback (R10) or hotfix? How do we identify affected notifications (`NotificationAttempt`)? Does cross-patient data in a reminder count as a breach?

Expected controls to surface: rollback path, additive migrations making rollback safe, notification audit, hazard log entry.

## After the exercise

1. Fill the log below.
2. Turn every "we do not know" into a ticket in docs_v2/19 or the phase plan.
3. Write the 72-hour notification playbook as `docs_v2/runbooks/R-BREACH-1-notification.md` using the decisions taken here (owner: engineering lead; sign: counsel).
4. Schedule the next tabletop for the quarter after V2.4 beta.

## Exercise log

| Date | Facilitator | Participants | Scenarios run | Findings (ticket ids) |
|---|---|---|---|---|
| | | | | |
