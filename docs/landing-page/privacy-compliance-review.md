# Privacy & Compliance Review — Medicine Passport by MediDocs

**Session 12 · 2026-08-12**

> **This is an engineering/product compliance-preparation document, not legal advice.** Nothing here is counsel-approved, legally sufficient, certified, or a statement of compliance. It exists to help qualified Indian privacy counsel and the business owner make decisions. Labels: **[EV]** engineering-verified · **[BD]** business decision · **[LI]** legal interpretation · **[CA]** counsel approval.

Factual basis: [privacy-data-inventory.md](privacy-data-inventory.md).

---

## 1. Authoritative legal sources reviewed

**Primary (Government of India):**
- **Digital Personal Data Protection Act, 2023** — Act No. 22 of 2023 (Parliament; President's assent 11 Aug 2023).
- **Digital Personal Data Protection Rules, 2025** — notified **14 November 2025** via **Gazette G.S.R. 846(E)**; MeitY.
  - MeitY document page: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
  - PIB press release, "Government notifies DPDP Rules, 2025" (PRID 2190014), 14 Nov 2025.
  - PIB press note "DPDP Rules, 2025 Notified" (NoteId 156054).
- **Gazette notification establishing the Data Protection Board of India** — effective on publication (13–14 Nov 2025).

**Secondary (interpretation/context only — clearly labelled, not relied on for conclusions):**
- Wikipedia, "Digital Personal Data Protection Rules, 2025" (for the phased-schedule summary).
- Law-firm commentary (Shardul Amarchand Mangaldas; S.S. Rana; Khurana & Khurana) — for the G.S.R. number and phasing narrative.

> The **exact rule-to-commencement-date mapping** and the interpretation of each obligation for MediDocs's facts **require counsel + the Gazette text** [CA]. The phasing below is the reported schedule, sufficient for readiness planning, not for legal reliance.

---

## 2. Phased commencement — as of 2026-08-12

The DPDP Rules 2025 roll out over ~18 months in three phases. **Today (Aug 2026) we are between Phase 1 and Phase 2.**

| Provision / obligation | Source | Commencement | Effective date | Relevant to MediDocs? | Notes |
|---|---|---|---|---|---|
| Data Protection Board of India established; definitions; Board machinery | DPDP Rules 2025 Phase 1 | **In force** | 14 Nov 2025 | Yes (regulator exists) | Board is operational now |
| Consent Manager registration framework | Phase 2 | **Future** | ~14 Nov 2026 | Only if MediDocs became a Consent Manager (it is not) | Not applicable unless registered |
| Cross-border transfer / restricted-country mechanism | Phase 2 | **Future** | ~14 Nov 2026 | **Yes** (R2/Railway location unverified) | Watch item; [CA] |
| Significant Data Fiduciary (SDF) obligations | Phase 2 | **Future** | ~14 Nov 2026 | Only if **government-notified** as SDF | Health data at scale *could* attract notification; not designated [LI] |
| **Consent notice** (standalone, clear, itemized purpose; multilingual) | Phase 3 | **Future** | **14 May 2027** | **Yes** | Proactive readiness |
| **Data Principal rights** (access, correction, erasure, grievance, nomination) + grievance handling | Phase 3 | **Future** | 14 May 2027 | **Yes** | Proactive readiness |
| **Personal data breach** notification (Board + affected individuals; ~72-hour detailed report) | Phase 3 | **Future** | 14 May 2027 | **Yes** | Proactive readiness |
| **Verifiable parental/guardian consent** for children (<18); no child-targeted ads | Phase 3 | **Future** | 14 May 2027 | **Yes** | Significant gap |
| Reasonable **security safeguards** (Rule 6) | Phase 3 | **Future** | 14 May 2027 | **Yes** | Many controls already exist |
| Retention limitation / erasure on purpose completion | Phase 3 | **Future** | 14 May 2027 | **Yes** | Retention undefined for core data |

**Consequence for wording:** because the substantive Data-Fiduciary obligations commence **14 May 2027**, most items below are **PROACTIVE READINESS**, not **CURRENT LEGAL REQUIREMENT** — *except* obligations arising under other laws already in force (see §5). Any MediDocs operation continuing on/after 14 May 2027 (virtually certain) must be compliant by then, so building now is prudent, not premature. **Do not tell the owner "you must do X today" on DPDP grounds alone unless the provision is in force or another current law creates the duty.**

---

## 3. Likely legal-role classification (counsel must confirm)

| Role | Likely applies? | Evidence | Confirmation |
|---|---|---|---|
| **Data Fiduciary** | **Likely yes** | MediDocs determines the purpose and means of processing patient medicine data (schema, APIs, product design) | [CA] confirm |
| **Data Processor** | For its vendors | Railway, Cloudflare/R2, Telnyx process on MediDocs's behalf | [CA] confirm each; DPAs needed |
| **Data Principal** | The patients/users | They are the natural persons whose data is processed | — |
| **Consent Manager** | **No** | Recording consent in-app ≠ being a registered Consent Manager (a specific DPDP-registered intermediary). **Do not claim this.** | [CA] |
| **Significant Data Fiduciary** | **Not established** | SDF status is by **government notification** (volume/sensitivity/risk). Health data *may* be a factor, but no designation exists. **Do not self-declare.** | [CA] / govt designation |

---

## 4. Notice requirements (DPDP §5 / Rules) vs. current product

DPDP requires a Data Fiduciary to give a **standalone, plain-language consent notice** stating the personal data processed, the specific purpose, how to exercise rights, how to withdraw consent, and how to complain to the Board — available in English and the Eighth-Schedule languages.

- **Current state [EV-partial]:** the backend has a real consent ledger and grant/revoke API, but **whether the patient app shows a DPDP-conforming standalone notice at/ before consent, with rights + withdrawal + grievance info, is NOT verified** and likely incomplete (no grievance contact exists to name).
- **Classification:** PROACTIVE READINESS (obligation commences 14 May 2027), but the notice also underpins any *current* consent basis under the IT Act/SPDI regime (§5).
- **Action:** design the onboarding notice; do **not** silently rewrite onboarding in Session 12. Substantial product change → design + approval. This is a **P1** gap.

---

## 5. Other Indian frameworks potentially in scope

| Framework | Might apply because… | In scope now? | Confirmation |
|---|---|---|---|
| **IT Act 2000 + SPDI Rules 2011** | Medical records/health = "sensitive personal data"; requires a **published privacy policy, consent, reasonable security** — and this is **in force today** (until DPDP fully supersedes) | **Likely yes, now** [LI] | [CA] — this is the strongest basis for having a privacy policy + security controls **at launch**, independent of DPDP phasing |
| **Telemedicine Practice Guidelines 2020** | Only if providing teleconsultation/clinical advice | **Likely no** — MediDocs is a patient record, not a doctor/telemedicine service | [CA] confirm the boundary holds |
| **ABDM / ABHA (health data exchange)** | Only if integrated with India's health-data network | **No** — no ABDM integration exists; **do not claim ABDM** | [CA] |
| **Drugs & Cosmetics / pharmacy law** | Only if selling/dispensing/substituting medicines | **No** — no sale/dispensing/substitution | [CA] |
| **Consumer protection / e-commerce** | Digital service to consumers | Possibly, general | [CA] |

---

## 6. Medical-device / regulatory classification

MediDocs manages patient-provided medicine information and shows human-reviewed educational content. It is explicitly **not** diagnostic, prescribing, or medicine-substitution software (no computed high/low flags, no dosing advice, no drug-drug interaction engine — verified in schema comments). One area to flag: the duplicate-ingredient/class-overlap and allergy **safety findings** feature (`SafetyEvaluation`/`SafetyFinding`) surfaces informational concerns. Whether any such feature raises a **medical-device/SaMD** question under CDSCO/MDR rules is **[LI][CA]** — do not decide casually; flag for counsel/product. (Session-11 marketing keeps clinical claims gated pending Stage-6 clinical validation.)

---

## 7. Breach-response readiness

- **Obligation (Phase-3, 14 May 2027):** notify the Board and affected individuals; a detailed report (reported as ~72 hours). **Do not treat as a current deadline** — but design now.
- **Current capability [EV]:** hash-chained audit log, access logs, environment separation, encrypted backups — good forensic substrate. **Gap:** no written incident-response runbook, no defined severity model, no notification templates, no owner. A minimal workflow is designed in [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md) §Security. **P1.**

---

## 8. Nomination (DPDP)

DPDP lets a Data Principal nominate someone to exercise rights on death/incapacity. MediDocs's **caregiver** model is *product delegation*, **not** statutory nomination. Do not equate them. Building nomination is **Phase-3 readiness [LI]** — flag, don't build now. **P2.**

---

## 9. Privacy-by-design gap list (prioritized, evidence-based)

| ID | Gap | Type | Severity | Evidence |
|---|---|---|---|---|
| G-01 | **Operating legal entity unresolved** — no fiduciary named | LEGAL/BUSINESS | **P0** | inventory §0 |
| G-02 | **No grievance channel / officer** (no mailbox, no route) | OPERATIONS/LEGAL | **P0** | DNS: no MX; no `@medidocs.app` in code |
| G-03 | **No account-wide erasure** (feature or process) | ENGINEERING/OPS | **P0→P1** | no deletion flow; enum unused |
| G-04 | Privacy Policy & Terms are **drafts, not counsel-approved** | LEGAL | **P0** | this session's drafts |
| G-05 | **Retention undefined** for core health data, documents, leads, backups | BUSINESS/ENG | **P1** | §8 inventory |
| G-06 | **Consent notice** may not meet DPDP standalone-notice standard; unverified in app | PRODUCT/LEGAL | **P1** | §4 |
| G-07 | **No verifiable guardian consent** for child profiles | PRODUCT/LEGAL | **P1** | inventory §9 |
| G-08 | **No incident-response runbook** | OPERATIONS | **P1** | §7 |
| G-09 | **Processor DPAs/locations unverified** (Railway, Cloudflare/R2, Telnyx) | LEGAL/OPS | **P1** | inventory §3–4 |
| G-10 | Cross-border transfer position unverified | LEGAL | **P1** | inventory §4 |
| G-11 | Rights request workflow (access/correction/erasure/withdrawal) not operationalized | OPERATIONS | **P1** | inventory §7 |
| G-12 | Data-export ("access") consolidated view absent | ENGINEERING | **P2** | inventory §7 |
| G-13 | Nomination not supported | PRODUCT | **P2** | §8 |
| G-14 | Disk-level encryption-at-rest of PG unverified | ENGINEERING | **P2** | inventory §5 |
| G-15 | SaMD/medical-device question on safety findings unassessed | LEGAL | **P2** | §6 |

None manufactured — each cites evidence.

---

## 10. Compliance-gap register

`Type`: LEGAL · PRODUCT · ENGINEERING · OPERATIONS · BUSINESS. Nothing is marked "compliant" merely because code looks reasonable.

| ID | Requirement/concern | Authoritative source | Current state | Evidence | Gap | Severity | Type | Owner | Launch blocker |
|---|---|---|---|---|---|---|---|---|---|
| C-01 | Identified Data Fiduciary/operator | DPDP §2/§5; SPDI r.4 | Unresolved | inventory §0 | Name entity | P0 | LEGAL/BUSINESS | Owner | **Yes** |
| C-02 | Published privacy policy | SPDI r.4 (now); DPDP §5 (2027) | Draft only | /privacy/ draft | Counsel approval | P0 | LEGAL | Counsel | **Yes** |
| C-03 | Grievance redressal contact/officer | DPDP; SPDI r.5(9) | None | no MX/mailbox | Provision + owner | P0 | OPERATIONS | Owner | **Yes** |
| C-04 | Consent + standalone notice | DPDP §5–6 (2027); SPDI (now) | Ledger yes; notice unverified | consents.controller.ts | Design notice | P1 | PRODUCT/LEGAL | Product+Counsel | Pending |
| C-05 | Erasure on request | DPDP §12 (2027) | Not implemented | no flow | Feature or process | P1 | ENGINEERING/OPS | Product | Pending |
| C-06 | Retention limitation | DPDP §8(7) (2027) | Undefined (core data) | §8 | Set policy | P1 | BUSINESS | Owner | Pending |
| C-07 | Breach notification capability | DPDP §8(6)/Rules (2027) | No runbook | §7 | Runbook | P1 | OPERATIONS | Owner | Pending |
| C-08 | Children/guardian consent | DPDP §9 (2027) | Not implemented | inventory §9 | Design | P1 | PRODUCT/LEGAL | Product+Counsel | Pending |
| C-09 | Processor DPAs + locations | DPDP §8(2); SPDI | Unverified | inventory §3 | Obtain/verify | P1 | LEGAL/OPS | Owner | Pending |
| C-10 | Cross-border position | DPDP §16 / Rules (2026) | Unverified | inventory §4 | Verify | P1 | LEGAL | Counsel | Pending |
| C-11 | Security safeguards | SPDI r.8 (now); DPDP Rule 6 (2027) | Strong controls; gaps | inventory §5 | Document/close | P2 | ENGINEERING | Eng | Pending |
| C-12 | Data-principal access/export | DPDP §11 (2027) | In-app view; no export | inventory §7 | Export/process | P2 | ENGINEERING | Product | Pending |
| C-13 | Nomination | DPDP §13 (2027) | None | §8 | Design | P2 | PRODUCT | Product | Pending |
| C-14 | SaMD classification of safety findings | CDSCO/MDR | Unassessed | §6 | Assess | P2 | LEGAL | Counsel | Pending |

---

## 11. OD-LP-6 — legal/privacy approval model

**OD-LP-6 — `APPROVED PROCESS / FINAL SIGN-OFF OPEN`.** Process: (1) engineering/product verify the drafts describe the real product and data flows [done this session]; (2) business owner approves business commitments [**done** — owner rulings #2/#3/#5/#6, [session12-owner-rulings.md](session12-owner-rulings.md)]; (3) qualified Indian privacy/legal **counsel** reviews applicable law and approves the final Privacy Policy and Terms [**packet assembled** — [counsel-brief.md](counsel-brief.md); engagement pending, ruling #7]; (4) only then may the `DRAFT — LEGAL REVIEW REQUIRED` banner and placeholders be removed; (5) production launch stays blocked until sign-off is documented. **OD-LP-6 is NOT closed by Claude producing drafts.**

---

## 12. Privacy / business marketing-claim classification (SPEC §34/§46)

Recorded here rather than in `02-marketing-claims.md`, which is being edited by a concurrent session (Session-12 register reconciliation is deferred — see the session report). Each row: **technically verified** vs. **business approval** vs. **legal approval** vs. **production-publication allowed**. Technical truth alone never overrides a business/legal gate.

| Claim | Technically verified? | Business approval | Legal approval | Publish on production? |
|---|---|---|---|---|
| **"We do not show advertising in the patient Medicine Passport experience"** | Yes — no ad system/vendor exists [EV] | **APPROVED** (owner ruling #6) | Pending counsel | **Gated on legal only** — bounded wording adopted as business policy |
| **"We do not sell identifiable patient health information"** | Yes — no sale/monetization path exists [EV] | **APPROVED** (ruling #6 — chosen over the over-absolute "never sell your data") | Pending counsel | **Gated on legal only** — bounded wording adopted |
| **You control your record / sharing** | Yes — patient-controlled shares, expiry, revoke [EV] | OK | Review wording | Allowed with Stage-7 bounds |
| **Revocation stops future access (not retroactive erasure of downloaded copies)** | Yes — Stage-7 verified [EV] | OK | Review wording | **Locked bounded wording — do not weaken** |
| **Deletion / erasure** | **No account-wide erasure exists** [EV] | Owner must define process | Legal must approve wording | **Gated** — draft promises only request-based deletion, no absolutes |
| **Security wording** (concrete controls) | Controls verified [EV]; no "bank-grade"/"fully secure" | OK | Review | Allowed as concrete-controls language only |
| **"Free for patients to create, maintain and access their core Medicine Passport"** | No paywall exists [EV] | **APPROVED** (ruling #6) | Pending counsel | **Gated on legal only** — exact bounded wording adopted |
| DPDP/HIPAA/GDPR/ISO/SOC2/ABDM "compliant/certified" | **No** — none verified | — | — | **PROHIBITED** (SPEC §47) |
