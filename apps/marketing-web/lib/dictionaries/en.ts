/**
 * English marketing dictionary — the master; MessageKey is typed from it,
 * mirroring packages/localization's pattern. hi/te/ur dictionaries are added
 * to lib/i18n.ts ONLY after professional translation review (OD-LP-4) —
 * never machine-translated placeholders.
 *
 * Copy source: docs/landing-page/04-content-spec.md (approved draft
 * directions, Session 2 gate corrections applied). GATED copy is NOT in this
 * file — see lib/content-gates.ts. Claim IDs referenced per string where a
 * ledger row governs it (docs/landing-page/02-marketing-claims.md).
 */
export const en = {
  "brand.name": "Medicine Passport",
  "brand.endorsement": "by MediDocs",
  "brand.company_line": "MediDocs",

  "nav.help": "Help",
  "nav.for_clinics": "For doctors & clinics",
  "nav.skip": "Skip to content",

  // MKT-001 (final wording still passes business/legal copy review) / MKT-002
  "header.cta": "Create my free Medicine Passport",
  "header.cta_short": "Start free",

  // S1 hero. Language chip = product-language statement (OD-LP-4 addendum).
  "hero.h1": "Your medicines. One place. In your language.",
  "hero.sub":
    "Keep track of what you take, why you take it, when to take it, and what to show your doctor — wherever you go.",
  "hero.chip_free": "Free for patients",
  "hero.chip_no_install": "No app to install",
  "hero.chip_languages": "App languages: English · हिंदी · తెలుగు · اردو",
  "hero.cta": "Create my free Medicine Passport",
  "hero.secondary": "See how it works",
  "hero.media_label": "Product demonstration",
  "hero.media_note": "Real app footage arrives with media production.",

  // S2 problem (Story B: Session 2 gate corrected neutral wording).
  "problem.h2": "Sound familiar?",
  "problem.a_title": "“Which medicines are you taking?”",
  "problem.a_body":
    "When every doctor has a different piece of your story, even a simple question becomes difficult. Strips in a drawer, prescriptions in a folder, photos on a phone — and a doctor waiting for an answer.",
  "problem.b_title": "Two names, one ingredient",
  "problem.b_body":
    "Doctor A prescribes one brand. Doctor B prescribes another. Two different brand names may contain the same ingredient — and there's no easy way for a family to tell.",
  "problem.c_title": "Caring from another city",
  "problem.c_body":
    "Your father's medicines are in Vijayawada. You're in Bengaluru. His memory of what changed at the last visit is the only record.",
  "problem.thesis":
    "Your medicine information should travel with you — not stay scattered across prescriptions, doctors, pharmacies and hospital files.",
  "problem.reveal": "That's what Medicine Passport is for.",

  // S3 product reveal (MKT-004, MKT-010).
  "reveal.h2": "One medicine record that belongs to the patient.",
  // Session 7 correction C: "It's your record" (not "You own it").
  "reveal.body":
    "Every medicine, with the details that matter: name, ingredient, strength, when and how to take it, which doctor prescribed it, and why — in plain words. It's your record. It goes where you go.",
  "reveal.card_caption": "Illustrative example — not a live screen.",
  "reveal.f_name": "Medicine",
  "reveal.f_name_v": "Glucomet 500",
  "reveal.f_ingredient": "Ingredient",
  "reveal.f_ingredient_v": "Metformin 500 mg",
  "reveal.f_schedule": "When",
  "reveal.f_schedule_v": "Morning and night, after food",
  "reveal.f_doctor": "Prescribed by",
  "reveal.f_doctor_v": "Dr. Rao",
  "reveal.f_reason": "Your recorded reason",
  "reveal.f_reason_v": "Blood sugar",
  "reveal.f_status": "Status",
  "reveal.f_status_v": "Current",

  // S4 know (MKT-011 bounded, MKT-012 bounded, MKT-013). Education sentence
  // (MKT-014) is clinical-gated and absent.
  "know.h2": "Know what you're taking.",
  "know.body":
    "Add medicines your way: photograph a prescription and confirm what Medicine Passport reads — you check every detail before it's saved. Or find your medicine by search, or enter it yourself. Prescription photos and reports stay attached to your record.",
  "know.chip_photo": "Photo",
  "know.chip_search": "Search",
  "know.chip_manual": "Type it in",
  "know.media_label": "Adding a medicine from a prescription photo",

  // S5 remember (MKT-020/021/023; MKT-024 prohibition honored; escalation
  // sentence MKT-022 clinical-gated and absent).
  "remember.h2": "Know what comes next.",
  "remember.body":
    "See today's medicines on one timeline. Mark doses taken, skipped or snoozed. Turn on browser reminders if you want them, and know when a medicine is running low. Medicine Passport helps keep today's medicines visible and organized.",
  "remember.chip_timeline": "Today's timeline",
  "remember.chip_reminders": "Optional reminders",
  "remember.chip_refills": "Refill awareness",
  "remember.media_label": "Today's timeline and dose recording",

  // S6 accessible (MKT-003 product-language statement; MKT-005 bounded).
  "access.h2": "Healthcare information shouldn't require perfect English, perfect eyesight or a new phone.",
  "access.sub": "Read it — or listen to it.",
  "access.body":
    "The Medicine Passport app speaks English, हिंदी, తెలుగు and اردو — including right-to-left Urdu. Guidance throughout the app can be read aloud at the tap of a listen button. Big text, big buttons, simple screens — built for real phones on real networks.",
  "access.lang_en": "English",
  "access.lang_hi": "हिंदी",
  "access.lang_te": "తెలుగు",
  "access.lang_ur": "اردو",
  "access.listen": "Listen",
  "access.media_label": "The same screen in four languages",
  "access.video_label": "Read-aloud in the app: tapping Listen, guidance playing, then Stop",
  "access.audio_cta": "Hear how Medicine Passport sounds",
  "access.audio_stop": "Stop",
  "access.audio_error": "Audio is unavailable right now",
  "access.audio_note": "The app's real guidance voice (English). Plays only when you press the button.",

  // S7 offline (MKT-040/041/042; honest bound per MKT-043 — body text).
  "offline.h2": "Your medicine record shouldn't disappear when the network does.",
  "offline.body":
    "Your saved medicines stay viewable without internet. Record doses offline — they sync when you're back. You always see whether you're offline, syncing, or up to date.",
  "offline.honest": "Reminders need a connection.",
  "offline.media_label": "Offline viewing and dose recording, then sync",

  // S8 caregiving (MKT-050/051/052 — all verified, ungated).
  "care.h2": "Help your parents without taking control away from them.",
  "care.body":
    "Invite family to help — and choose exactly what each person can see or do. Manage a parent's or dependent's medicines from anywhere. Every caregiver access is visible to the patient, and access can be removed at any time.",
  "care.tagline": "Help that is granted, bounded, visible — and removable.",
  "care.cta": "Create a Medicine Passport for my family",
  "care.media_label": "Inviting a caregiver and choosing permissions",

  // S9 share (Stage 7 CLEARED 2026-08-12). Revocation wording is precise:
  // future link access can be stopped; already-downloaded copies cannot.
  "share.h2": "Bring your medicine list to the appointment — not a folder of paper.",
  "share.body":
    "Create a share with a QR code or a link that lasts as long as you choose. The doctor opens a structured summary on their own device — no MediDocs account, nothing to install. You can stop the link at any time, and see when it was opened.",
  "share.chip_qr": "QR or link",
  "share.chip_expires": "You set how long it lasts",
  "share.chip_no_account": "No doctor account",
  "share.chip_revocable": "Stop the link any time",
  "share.media_label": "Creating a share, and the summary a doctor sees",

  // S12 professional bridge.
  "bridge.h2": "Are you a doctor, pharmacist or clinic?",
  "bridge.body":
    "See how a patient-held Medicine Passport can make medication information easier to review when the patient chooses to share it.",
  "bridge.cta": "Medicine Passport for healthcare professionals",

  // S10 free (MKT-001 + OD-LP-1 approved framing; MKT-006 prohibition
  // honored; never-sold chip MKT-072 business/legal-gated and absent).
  "free.h2": "Medicine Passport is free for patients.",
  // Session 7 correction A: "share" removed from public free-wording while the
  // Stage 7 sharing gate is OFF; the approved "…and share" wording returns
  // through the gate when Stage 7 clears.
  "free.body":
    "Your medicine information belongs to you. Medicine Passport is free for patients to create, maintain and access. We plan to sustain MediDocs through services and partnerships with healthcare organizations — not by charging patients for access to their own medicine information.",
  "free.chip_no_ads": "No advertising in the patient experience",
  "free.chip_no_paywall": "No paywall on your own record",

  // S11 trust (does-list built only from verified ungated claims).
  "trust.h2": "Built to help you understand your medicines — not to replace your doctor.",
  "trust.does_h3": "Medicine Passport does",
  "trust.does_1": "Keep your medicine information organized — and yours.",
  "trust.does_2": "Show today's doses on one timeline, with optional browser reminders.",
  "trust.does_3": "Work offline for viewing and recording, syncing when you're back.",
  "trust.does_4": "Let family help through permissions you grant, see, and can remove.",
  "trust.not_h3": "Medicine Passport does not",
  "trust.not_1": "It does not diagnose or prescribe.",
  "trust.not_2": "It does not tell you to start or stop a medicine.",
  "trust.not_3": "It does not substitute one medicine for another.",
  "trust.not_4": "It does not declare any medicine “safe”.",
  "trust.not_5": "It does not replace doctors or pharmacists.",

  // S13 FAQ (9 rendered; Q-numbers refer to 04-content-spec).
  "faq.h2": "Questions families actually ask.",
  "faq.q1": "Is Medicine Passport really free?",
  "faq.a1":
    "Yes — free for patients to create, maintain and access. We plan to sustain MediDocs through services and partnerships with healthcare organizations, not by charging patients.",
  "faq.q2": "Do I need to install an app?",
  "faq.a2":
    "No. Medicine Passport works in your phone's browser. You can add it to your home screen if you like, but you never have to.",
  "faq.q3": "Which languages does the app support?",
  "faq.a3":
    "The app supports English, Hindi, Telugu and Urdu. This website is currently in English, with more languages coming after translation review.",
  "faq.q4": "Can my family help manage my medicines?",
  "faq.a4":
    "Yes. Invite a family member and choose exactly what they can see or do. You can see every access they make, and remove their access at any time.",
  "faq.q6": "Can it tell me whether two medicines are safe together?",
  "faq.a6":
    "No. Medicine Passport does not check drug interactions and never declares any combination safe. Questions about taking medicines together belong with your doctor or pharmacist.",
  "faq.q7": "Does Medicine Passport replace medical advice?",
  "faq.a7":
    "No. It helps you keep and understand your own medicine information. Decisions about your medicines always belong with your doctor or pharmacist.",
  "faq.q8": "What happens if I have no internet?",
  "faq.a8":
    "Your saved medicines stay viewable, and you can record doses offline — everything syncs when you're back. Reminders need a connection.",
  "faq.q9": "Who can see my information?",
  // Session 7 correction B: bounded user-control wording; never a summary of
  // the future privacy policy.
  "faq.a9":
    "Your Medicine Passport isn't publicly listed. Family caregivers only receive the access you grant them, and you can remove that access at any time.",
  "faq.q10": "Can I remove a family member's access?",
  "faq.a10":
    "Yes, at any time. Caregiver access is granted by you, visible to you, and removable by you.",

  // S14 final CTA.
  "final.h2": "Take your medicine information with you.",
  "final.sub": "Start your Medicine Passport today.",
  "final.qr": "Scan to open on your phone",

  // ── /for-clinics/ (C1–C7), Stage 7 CLEARED ──────────────────────────────
  "clinics.meta_title": "Medicine Passport for doctors & clinics | MediDocs",
  "clinics.meta_description":
    "A free, patient-held medication record. When a patient shares it, you see a structured, patient-confirmed summary in seconds — no account, nothing to install.",
  "clinics.c1_h1": "A clearer medication picture, brought by the patient.",
  "clinics.c1_body":
    "Medicine Passport is a free, patient-held medication record. When a patient shares it, you see a structured, patient-confirmed summary — in seconds, with nothing to install. The patient owns and controls the record.",
  "clinics.c1_cta": "Bring Medicine Passport to your patients",
  "clinics.c1_secondary": "See what patients use",
  "clinics.c2_h2": "“What medicines are you taking?” shouldn't be the hardest question of the visit.",
  "clinics.c2_body":
    "Medication information arrives as loose prescriptions, discharge summaries, photographs and memory. Piecing it together takes time the consultation doesn't have.",
  "clinics.c3_h2": "A structured list, not a shoebox of paper.",
  "clinics.c3_body":
    "Current medicines with ingredients, strengths and instructions; recorded allergies; recent changes — as the patient confirmed them. Built live at the moment of access, not a stale export. A PDF when paper is easier (English).",
  "clinics.c3_media_label": "The summary a doctor sees when a patient shares",
  "clinics.c4_h2": "No doctor account. No software to install.",
  "clinics.c4_step1": "Your patient presents a QR code or a link.",
  "clinics.c4_step2": "You open their patient-shared summary.",
  "clinics.c5_h2": "Access the patient grants — and can take away.",
  "clinics.c5_body":
    "Shares are created by the patient, last as long as the patient chooses, and the patient can stop the link at any time. Every access is recorded and visible to the patient. Stopping a link ends future access through it — it can't recall a copy already downloaded.",
  "clinics.c5_chip_patient": "Patient creates the share",
  "clinics.c5_chip_expires": "Time-limited",
  "clinics.c5_chip_revocable": "Patient can stop the link",
  "clinics.c5_chip_logged": "Every access recorded",
  "clinics.c6_h2": "Better inputs to the decisions you already make.",
  "clinics.c6_tile1": "Easier access to patient-supplied medication information.",
  "clinics.c6_tile2": "A structured, ingredient-level view.",
  "clinics.c6_tile3": "Fewer handwritten pages to interpret.",
  "clinics.c6_tile4": "Patient-controlled information exchange.",
  "clinics.c7_h2": "Bring Medicine Passport to your patients.",
  "clinics.c7_body": "Tell us who you are — we'll help you introduce Medicine Passport at your clinic or pharmacy.",

  // Lead form (OD-LP-2). Never collects patient/health data.
  "lead.name": "Name",
  "lead.organization": "Organization / clinic",
  "lead.role": "Role",
  "lead.role_doctor": "Doctor",
  "lead.role_pharmacist": "Pharmacist",
  "lead.role_clinic_owner": "Clinic owner",
  "lead.role_hospital_admin": "Hospital administrator",
  "lead.role_care_coordinator": "Care coordinator",
  "lead.role_other": "Other",
  "lead.role_placeholder": "Select your role",
  "lead.city": "City",
  "lead.email": "Email",
  "lead.phone": "Phone",
  "lead.contact_hint": "Enter an email or a phone number (at least one).",
  "lead.message": "Message (optional)",
  "lead.no_patient_data": "Please do not include patient or medical information.",
  "lead.consent": "I agree to be contacted by MediDocs about Medicine Passport.",
  "lead.submit": "Send",
  "lead.submitting": "Sending…",
  "lead.success_title": "Thanks — we'll be in touch.",
  "lead.success_body": "We've received your details.",
  "lead.error_generic": "Something went wrong. Please try again.",
  "lead.error_contact": "Please provide an email or a phone number.",
  "lead.error_consent": "Please agree to be contacted so we can reply.",
  "lead.required": "required",

  "footer.privacy": "Privacy",
  "footer.terms": "Terms",
  "footer.language": "Language",

  "media.placeholder_badge": "Preview",

  "placeholder.privacy.title": "Privacy policy",
  "placeholder.terms.title": "Terms of use",
  "placeholder.legal.body":
    "This page is being prepared and reviewed. It is not yet published policy.",

  "notfound.title": "This page doesn't exist.",
  "notfound.home": "Go to the home page",
} as const;
