# 18 — Team and Governance

## 1. Roles (roadmap §38)

| Group | Role | Workstreams | Fractional OK? |
|---|---|---|---|
| Product | product/program lead · clinical product manager · business analyst | WS01, WS02, WS17 | lead no; others yes |
| Clinical | physician adviser · pharmacist · clinical informatics/FHIR specialist | WS11, WS09, gates | physician/pharmacist yes; FHIR specialist needed ≥ 50 % during M8 |
| Design | product designer · UX researcher · accessibility/localization support | WS02, Gate 4 | researcher yes |
| Engineering | technical architect · frontend/PWA engineers (2) · backend engineers (2) · interoperability/FHIR engineer · data engineer · AI/document engineer · DevSecOps/SRE | WS03–WS10, WS12, WS14 | SRE and data engineer can be shared early |
| Quality | QA automation · security testing · interoperability testing | WS15 | security testing external |
| Compliance | privacy/compliance adviser · security lead | WS13 | adviser yes |
| Business | partnerships · clinic/pharmacy onboarding · customer operations | WS17, WS18 | yes until pilot |

Minimum viable core for Phases 0–2: architect, two backend, one frontend, one QA, fractional clinical (physician + pharmacist), fractional compliance, one SRE. Everything else scales in for Phases 3+.

## 2. The four governance layers (roadmap §39)

| Board | Owns | Cadence | Members | Records |
|---|---|---|---|---|
| Product Council | prioritization, scope, phase gates, release go/no-go | monthly + per gate | product lead (chair), architect, clinical lead, compliance, business | `docs_v2/validation/product-council/` |
| Architecture Board | ADRs, migrations, service boundaries, vendor adapters | fortnightly | architect (chair), backend lead, frontend lead, SRE, FHIR engineer | [adr/](adr/README.md) |
| Clinical Safety Board | rules, insights, copy, AI, hazard log, Gates 1–6 | fortnightly; 48 h for incidents | clinical lead (chair), physician, pharmacist, product, compliance | `docs_v2/validation/safety-board/` |
| Privacy & Security Board | data, access, consent, DPIA, vendor DPAs, incidents | fortnightly | security lead (chair), privacy adviser, architect, SRE | `docs_v2/validation/privacy-security/` |

Every major requirement answers four questions before it is scheduled:

```
Does the patient need it?          → Product Council
Can we build it correctly?         → Architecture Board
Is it clinically safe?             → Clinical Safety Board
Can we legally and securely process it? → Privacy & Security Board
```

A "no" from any board blocks; disagreements escalate to the Product Council with the dissent recorded.

## 3. Decision flow

1. Proposal (work package or ADR draft) opened in the status board.
2. Boards review in their next session (or async within 5 working days).
3. Decision recorded (accepted / accepted with conditions / rejected) with owner and date.
4. Implementation PRs link the decision; the PR template asks for it.
5. Phase exit: evidence pack reviewed by the Product Council.

## 4. Change control for this document set

- `docs_v2/` is edited via PRs like code; each change updates [20-status-board.md](20-status-board.md).
- ADRs are immutable once accepted; changes are new ADRs that supersede.
- The status vocabulary is fixed (README); a new status needs a Product Council decision.
