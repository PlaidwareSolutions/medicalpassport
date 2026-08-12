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
| `support@` provisioned + owner | **BLOCKED / PENDING OWNER** | No MX; owner unnamed (OD-LP-7) |
| `privacy@` (grievance) provisioned + owner | **BLOCKED / PENDING OWNER** | Grievance officer required |
| `security@` provisioned + owner | **BLOCKED / PENDING OWNER** | — |
| `partnerships@` provisioned + owner | **BLOCKED / PENDING OWNER** | Routes into existing lead flow |
| Primary + backup owners named | **PENDING OWNER** | Continuity requirement |
| Ticket/tracking mechanism chosen | **PENDING OWNER** | V1 can be lightweight |

## Privacy / product
| Gate | State | Note |
|---|---|---|
| Data-principal rights workflow (access/correction/erasure/withdrawal) | **BLOCKED** | No operational process yet (inventory §7) |
| Retention policy for core health data / documents / leads / backups | **PENDING OWNER** | Undefined today (inventory §8) |
| Children / guardian-consent approach | **PENDING OWNER / PRODUCT** | No verifiable-guardian mechanism (inventory §9) |
| Account erasure capability or process | **BLOCKED** | No feature and no process (inventory §7) |
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
| Privacy/business claims (no-ads, never-sell, deletion, security wording) | **PENDING OWNER/LEGAL** | See review; keep gated until approved |
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

## Top launch blockers (P0)
1. **Legal entity** unresolved (Legal).
2. **Privacy Policy + Terms** counsel sign-off (OD-LP-6, Legal).
3. **Grievance/privacy + security contact** provisioned with owners (OD-LP-7, Operations/Security).
4. **Erasure** capability or operational process (Privacy/product).
5. **Rights request workflow** operationalized (Privacy/product).

Production Cloudflare provisioning + apex cutover are **later launch activities**, intentionally not performed this session.
