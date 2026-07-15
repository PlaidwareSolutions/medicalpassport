# 01 — Personas and Jobs to Be Done

Design constraints that apply to **all** patient-facing personas: limited medical knowledge, possibly limited reading ability and English proficiency, older/inexpensive Android devices, intermittent connectivity, limited storage, difficulty typing, difficulty reading handwritten prescriptions, multiple prescribers, limited access to a regular pharmacist, limited familiarity with app installation.

## P1 — Lakshmi, 68, retired teacher (older adult, self-managing)

- Type 2 diabetes + hypertension + thyroid; 7 medicines from 3 doctors.
- Reads Telugu comfortably, English with difficulty. Uses a 3-year-old budget Android phone on prepaid data.
- **Jobs:** know what's due now; hear instructions read aloud; show a new doctor everything she takes; avoid taking "the sugar tablet" twice because two doctors used different brands.
- **Design implications:** Telugu UI + text-to-speech, large touch targets, timeline organized around meals, doctor-visit mode, duplicate-ingredient detection.

## P2 — Arjun, 42, IT professional (caregiver for parents)

- Manages medicines for both parents in another city. Comfortable in English, uses a flagship phone.
- **Jobs:** see both parents' medication lists and adherence; get escalation when a dose is missed; add a medication after a hospital visit; share a summary with a specialist over WhatsApp.
- **Design implications:** multiple dependent profiles under one caregiver account; granular, revocable, audited permissions enforced server-side; caregiver reminder escalation; WhatsApp-friendly summary export.

## P3 — Fatima, 55, homemaker (low literacy, Urdu-first)

- Recently discharged after cardiac event with a 9-item discharge summary in English.
- Struggles with typing; her daughter helps set things up.
- **Jobs:** get the discharge summary into the app by photographing it; understand each medicine in Urdu, spoken aloud; get SMS reminders because she doesn't grant browser permissions.
- **Design implications:** camera capture with human confirmation of every extracted field, Urdu localization (RTL), voice-assisted entry, SMS/WhatsApp reminder fallback, icons with labels, minimal typing.

## P4 — Ravi, 30, gig worker (intermittent connectivity)

- One chronic medicine + occasional antibiotic courses. Cheap phone, almost no free storage, patchy network.
- **Jobs:** check today's doses offline; record "taken" offline and have it sync later; not be forced to install anything.
- **Design implications:** offline app shell, IndexedDB medication/schedule cache, offline dose recording with idempotent mutation queue, clear online/offline/syncing status, works as a plain website.

## P5 — Dr. Mehta, physician (medication-list consumer)

- Sees 60 patients/day; needs a patient's current medicines in under 30 seconds.
- **Jobs:** scan a QR or open a time-limited link; see current medicines, ingredients, doses, allergies, recent changes, unresolved concerns; trust that the list is patient-confirmed.
- **Design implications:** doctor-visit mode, secure share links with expiry/revocation/audit, no-store caching, clinical detail level distinct from patient view.

## P6 — Priya, pharmacist (reconciliation helper)

- **Jobs:** compare what the patient says with what's recorded; spot duplicate ingredients across brands; flag concerns for the doctor.
- **Design implications:** ingredient-level normalization visible in shares, "same ingredient, different brand" surfacing, concern list with evidence sources.

## P7 — Clinical administrator (internal)

- Maintains the medication catalog, brand→ingredient mappings, approved patient-education content, translations, and safety rules.
- **Jobs:** approve content through maker-checker; review alert quality and incidents; keep sources versioned and review dates current.
- **Design implications:** separate admin portal with stronger authentication, maker-checker workflows, version history, audit review ([08.3 in spec → 14.8 module](12-system-architecture.md)).

## Top jobs-to-be-done (ranked)

| # | Job | Personas | Core module |
|---|-----|----------|-------------|
| 1 | Keep an accurate current-medication list | all patients | Medication passport |
| 2 | Know what's due now / what I missed | P1, P3, P4 | Timeline + reminders |
| 3 | Understand each medicine in my language | P1, P3 | Knowledge + TTS |
| 4 | Get prescriptions in via photo, not typing | P3, P1 | Capture + OCR + confirmation |
| 5 | Avoid duplicate ingredients across brands | P1, P6 | Safety review |
| 6 | Manage a parent's medicines remotely | P2 | Caregiver mode |
| 7 | Show a doctor everything quickly | P1, P5 | Doctor-visit mode + sharing |
| 8 | Work despite bad connectivity | P4 | Offline-first PWA |

## The 20 core patient questions

The UI must let a patient answer these quickly (spec §5); [06-information-architecture](06-information-architecture.md) maps each to a screen: current medicines; names; active ingredients; why prescribed; common uses; how much; when; before/after food; how long; common side effects; warning signs; same ingredient under multiple brands; potential interactions; which doctor prescribed what; what to show a new doctor; doses due now; missed doses; medicines running out; concerns needing professional review; who has caregiver access.
