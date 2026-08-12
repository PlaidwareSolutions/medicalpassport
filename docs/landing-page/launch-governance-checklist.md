# Launch Governance Checklist — medidocs.app (public marketing apex)

**Session 12 · 2026-08-12 · Controlling pre-launch gate list.**

This is the authoritative list of what must be true before `medidocs.app` can go public. States: **PASS** · **BLOCKED** · **PENDING OWNER** · **PENDING LEGAL** · **PENDING PRODUCTION PROVISIONING** · **N/A**. Sources: [privacy-data-inventory.md](privacy-data-inventory.md), [privacy-compliance-review.md](privacy-compliance-review.md), [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md), [analytics-and-attribution.md](analytics-and-attribution.md), [stage7-sharing-security-review.md](stage7-sharing-security-review.md).

> Marketing staging (`staging.medidocs.app`) is fully live and verified (Sessions 6–11). Nothing below changes staging. Production apex is **not** launched.

## Legal
| Gate | State | Note |
|---|---|---|
| Operating legal entity identified & evidenced | **BLOCKED** | No entity resolved; `[LEGAL ENTITY TO BE CONFIRMED]` (inventory §0) |
| Privacy Policy finalized | **PENDING LEGAL** | Draft live on staging; counsel sign-off required (OD-LP-6) |
| Terms of Use finalized | **PENDING LEGAL** | Draft live on staging; counsel sign-off required |
| DPDP / applicable-law review | **PENDING LEGAL** | Phasing + role + notice + children + cross-border need counsel (review §2–§10) |
| Counsel sign-off documented | **PENDING LEGAL** | Hard launch gate; removes draft banner/placeholders |

## Operations
| Gate | State | Note |
|---|---|---|
| `support@` provisioned + owner | **BLOCKED / PENDING OWNER** | Mechanism chosen: **Google Workspace** (ruling #4); no MX yet; owner unnamed |
| `privacy@` (grievance) provisioned + owner | **BLOCKED / PENDING OWNER** | Google Workspace; grievance officer required |
| `security@` provisioned + owner | **BLOCKED / PENDING OWNER** | Google Workspace; security-escalation owner required |
| `partnerships@` provisioned + owner | **BLOCKED / PENDING OWNER** | Routes into existing lead flow |
| Primary + backup owners named | **PENDING OWNER** | Continuity requirement (ruling #4) |
| Prove inbound + outbound mail before publishing addresses | **PENDING PRODUCTION PROVISIONING** | Publish no address until proven (ruling #4) |

## Privacy / product
| Gate | State | Note |
|---|---|---|
| Data-principal rights workflow (access/correction/erasure/withdrawal) | **PENDING OWNER** | Erasure process approved (ruling #3); still needs owner + runbook |
| Retention policy for core health data / documents / leads / backups | **PENDING LEGAL + ENG** | **Policy approved** (ruling #2); counsel to confirm; erasure/lead/backup purge jobs not yet built |
| Children / guardian-consent approach | **PENDING PRODUCT** | **Policy approved** (ruling #5); design done ([children-guardian-remediation-design.md](children-guardian-remediation-design.md)); patient-app implementation pending |
| Account erasure capability or process | **PENDING OWNER** | **Manual process approved** (ruling #3); needs owner + runbook; self-service later |
| Consent + DPDP-style notice verified in app | **PENDING PRODUCT** | Ledger exists; notice unverified (review §4) |

## Security
| Gate | State | Note |
|---|---|---|
| Stage-7 sharing security review | **PASS** | Committed; verified (stage7 review) |
| Stage-7 F1 noindex + `private, no-store` on share/patient pages | **PASS** | Live-verified |
| Incident-response runbook | **PENDING OWNER** | Design in ops §4; owner + templates needed |
| Production Turnstile enforcing | **PENDING PRODUCTION PROVISIONING** | Prod widget/secret not created (deferred) |
| Security contact channel | **BLOCKED / PENDING OWNER** | Tied to `security@` |

## Infrastructure (production — all deferred, documented only)
| Gate | State | Note |
|---|---|---|
| Production Turnstile widget + secret (`medidocs.app` only) | **PENDING PRODUCTION PROVISIONING** | Not created (SPEC §55) |
| Production Web Analytics site + token (separate from staging) | **PENDING PRODUCTION PROVISIONING** | Not created |
| Production API CORS (`https://medidocs.app`) applied | **PENDING PRODUCTION PROVISIONING** | Staged in `railway.prod.ts`, **not applied** |
| Apex `medidocs.app` DNS / custom domain | **PENDING PRODUCTION PROVISIONING** | No A/MX today (verified) |
| `www.medidocs.app` redirect | **PENDING PRODUCTION PROVISIONING** | Not configured |
| Production Cloudflare headers / CSP (analytics origins) | **PENDING PRODUCTION PROVISIONING** | Staging verified; prod not activated |
| Marketing assets (`assets.medidocs.app`) | **PASS** | Live (public marketing only) |

## Content
| Gate | State | Note |
|---|---|---|
| Clinical claim gate (Stage-6) | **PENDING** | Safety claims stay gated until clinical validation |
| Privacy/business claims (free, no-ads, no-sale) | **PENDING LEGAL** | **Business-approved** (ruling #6); bounded wording in drafts; publication gated on counsel |
| English content final | **PASS (staging)** | Homepage/for-clinics live; legal pages draft |
| Locale gates (hi/te/ur, non-English recordings) | **N/A this launch** | English-first; translations deferred |

## Launch execution
| Gate | State | Note |
|---|---|---|
| Production static build (no draft placeholders) | **PENDING** | Build guard added (SPEC §57); passes only when placeholders resolved |
| Sitemap/robots for production (index Privacy/Terms only when approved) | **PENDING** | Staging stays noindex/disallow |
| Remove staging noindex — **N/A for staging** | **N/A** | Staging must stay noindexed |
| Live smoke test on apex | **PENDING PRODUCTION PROVISIONING** | Post-cutover |
| Rollback plan | **PENDING** | Define before cutover |

---

## Top launch blockers (P0) — after owner rulings ([session12-owner-rulings.md](session12-owner-rulings.md))
1. **Legal entity** — owner to supply exact registered entity (ruling #1). *Still open.*
2. **Counsel sign-off** on Privacy Policy + Terms (OD-LP-6) — packet assembled ([counsel-brief.md](counsel-brief.md)); engagement pending.
3. **Contacts provisioned + owners named** (OD-LP-7) — Google Workspace chosen (ruling #4); mailboxes/owners still pending.
4. **Erasure** — manual process *approved* (ruling #3); needs a named owner + runbook, plus the removal/retention cron jobs (ruling #2).
5. **Children/guardian V1** — policy *approved* (ruling #5); patient-app implementation pending (design done).

**Resolved to policy this session (no longer "undefined"):** retention schedule (ruling #2), erasure process (#3), children policy (#5), the three business claims (#6). Each still has a counsel and/or engineering follow-through above.

Production Cloudflare provisioning + apex cutover are **later launch activities**, intentionally not performed this session.
