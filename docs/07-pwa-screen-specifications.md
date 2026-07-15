# 07 — PWA Screen Specifications

Detailed specifications for all 41 initial patient PWA screens (spec §26). Each screen specifies: Objective · Primary user · Information shown · Primary action · Secondary actions · Empty state · Loading state · Error state · Offline state · Unsupported-browser state · Accessibility · Localization · Analytics events · Audit events · Security · Acceptance criteria.

## Shared defaults (apply to every screen unless overridden)

- **Loading:** skeleton placeholders matching final layout; no spinners longer than 300 ms without a skeleton; never block on non-critical data.
- **Error:** plain-language message + "Try again" primary button; error reference code (opaque); never raw technical text; errors reported without PHI.
- **Offline:** persistent banner "You're offline — showing saved information"; cached data rendered where available; writes queue where supported, otherwise disabled with explanation.
- **Unsupported browser:** feature-detect; degrade per [32-browser-capability-and-fallback-matrix](32-browser-capability-and-fallback-matrix.md); never dead-end — always show the fallback path.
- **Accessibility:** WCAG 2.1 AA; touch targets ≥ 48×48 dp; text scalable to 200%; contrast ≥ 4.5:1; screen-reader labels on all controls; focus order = visual order; reduced-motion respected; one primary action per screen ([33-accessibility-strategy](33-accessibility-strategy.md)).
- **Localization:** all strings from `packages/localization` keys; en/hi/te/ur; Urdu RTL; numerals and dates localized; medical terms use approved translations only.
- **Analytics:** `screen_viewed {screen}` on entry plus listed events; event payloads contain opaque IDs only, never PHI ([12.5 rule](12-system-architecture.md)).
- **Audit:** listed events written server-side via `packages/audit`; every PHI read/write audited.
- **Security:** authenticated session required (except Welcome/Language/OTP/Help/share pages); responses `Cache-Control: private, no-store` for personalized content; authorization enforced server-side per active profile.
- **Acceptance criteria** always include: renders correctly at 320 px width; usable one-handed; passes axe automated a11y checks; all four locales render without truncation.

---

## Onboarding & identity

### 1. Welcome
- **Objective:** communicate what the product is (and is not) and start sign-in, instantly, uninstalled.
- **Primary user:** first-time patient.
- **Information:** product name, one-line value ("Keep all your medicines in one place"), "not a replacement for your doctor" note, illustration.
- **Primary action:** Get started. **Secondary:** change language, Help.
- **Empty:** n/a. **Offline:** static shell cached after first visit; explains connection needed to sign in.
- **Analytics:** `welcome_get_started`. **Audit:** none (pre-auth). **Security:** public; no PHI.
- **Acceptance:** loads < 3 s on 3G; works with zero prior visits.

### 2. Language selection
- **Objective:** pick UI language before anything else.
- **Primary user:** all; critical for P3 (Urdu-first).
- **Information:** language names in their own script (English / हिन्दी / తెలుగు / اردو), speaker icon to hear each.
- **Primary action:** select language. **Secondary:** continue in English.
- **Unsupported:** TTS preview absent → text-only list.
- **Analytics:** `language_selected {locale}`. **Audit:** none pre-auth; preference saved to profile post-auth.
- **Acceptance:** selection persists across sessions (localStorage pre-auth, profile post-auth); RTL flips correctly for Urdu.

### 3. OTP login
- **Objective:** authenticate via mobile number + OTP.
- **Primary user:** all patients/caregivers.
- **Information:** phone field (+91 default), consent-to-terms line, resend timer, attempt feedback.
- **Primary action:** Send code → Verify. **Secondary:** change number, resend (rate-limited), get help.
- **Error:** wrong/expired code messaging without revealing whether number is registered (enumeration-safe); lockout message after attempt limit.
- **Offline:** disabled with "Connection needed to sign in".
- **Unsupported:** WebOTP autofill absent → manual entry.
- **Analytics:** `otp_requested`, `otp_verified`, `otp_failed {reason_code}`. **Audit:** `auth.otp_requested`, `auth.otp_verified`, `auth.otp_failed`, `auth.session_created` (server).
- **Security:** Turnstile hook on suspicious traffic; OTPs hashed server-side; resend/attempt limits; no OTP in URLs/logs; responses no-store.
- **Acceptance:** attempt/resend limits enforced server-side and reflected in UI; screen reader announces countdown politely.

### 4. Create patient profile
- **Objective:** minimal viable profile: name, year of birth, optional sex, optional allergies/conditions (skippable).
- **Primary user:** new patient or caregiver creating own profile.
- **Primary action:** Save and continue. **Secondary:** skip optional steps, add later.
- **Empty:** n/a (is the empty flow). **Offline:** blocked pre-first-sync; queued edits post-creation.
- **Analytics:** `profile_created {fields_completed_count}`. **Audit:** `profile.created`.
- **Security:** profile bound to authenticated user; consent record created for data processing.
- **Acceptance:** completable with ≤ 10 taps and no free-text typing except name.

### 5. Add dependent
- **Objective:** caregiver creates a managed profile (parent/child) they administer.
- **Primary user:** caregiver (P2).
- **Information:** relationship picker, dependent details, consent explanation (who this data belongs to, dependent may claim the profile later).
- **Primary action:** Create dependent profile. **Secondary:** invite dependent to own account instead.
- **Analytics:** `dependent_added {relationship}`. **Audit:** `caregiver.dependent_created`, consent event.
- **Security:** creates caregiver_relationship with full-management scope, audited; claimable via OTP on dependent's number later.
- **Acceptance:** profile switcher immediately shows the dependent.

### 6. Add caregiver / Caregiver permissions
- **Objective:** grant, review, and revoke granular caregiver access.
- **Primary user:** patient (P1) granting; caregiver viewing what they hold.
- **Information:** current caregivers with per-scope chips (view meds, view schedule, manage reminders, record doses, add meds, edit meds, review concerns, share records, manage profile, full management), grant dates, optional expiry, last-used.
- **Primary action:** Invite caregiver (mobile number + scope selection). **Secondary:** edit scopes, set expiry, revoke, view access history.
- **Empty:** "No caregivers yet" + explanation of what caregivers can do.
- **Analytics:** `caregiver_invited`, `caregiver_scope_changed`, `caregiver_revoked`. **Audit:** `consent.caregiver_granted/updated/revoked`, `caregiver.access_used` (on every use, server-side).
- **Security:** invitation bound to phone number, accepted via OTP-verified account; **enforcement server-side**; revocation effective immediately including active sessions.
- **Acceptance:** revoked caregiver's next API call fails with 403 even with warm client cache.

## Home & daily use

### 7. Home
- **Objective:** answer "what needs my attention now" in priority order: due now → due next → missed → unresolved concerns → refill/completion reminders.
- **Primary user:** all patients daily.
- **Information:** the five priority sections; sync status banner; active-profile indicator (caregivers).
- **Primary action:** record dose on the top due item. **Secondary:** open timeline, concerns, medicines.
- **Empty:** friendly first-run: "Add your first medicine" + scan option.
- **Offline:** cached content with banner; dose recording queues.
- **Analytics:** `home_section_tapped {section}`. **Audit:** dose events audited on write.
- **Acceptance:** due-now item visible without scrolling on a 320×568 viewport.

### 8. Today's medication timeline
- **Objective:** full day at a glance: Morning / Breakfast / Midday / Lunch / Evening / Dinner / Bedtime / custom times.
- **Information:** per slot: medicine name (or privacy-safe label), dose quantity, food instruction icon, status (upcoming/taken/skipped/missed/snoozed).
- **Primary action:** tap a dose → Record dose sheet. **Secondary:** jump to date, view medicine detail.
- **Empty:** "No medicines scheduled today" with add CTA.
- **Offline:** fully functional from cache; writes queue.
- **Analytics:** `timeline_viewed {date_offset}`, `dose_action {action}`. **Audit:** `dose.recorded` etc. server-side.
- **Acceptance:** all §14.4 states reachable: Taken, Skipped, Snooze, Could not take, Medicine unavailable, Experiencing a problem, Taken at another time.

### 9. Current medication passport
- **Objective:** the canonical current-medicines list (question 1 of 20).
- **Information:** cards: brand name, active ingredient(s), strength, schedule summary, prescriber, status chip (current/paused), duplicate-ingredient badge when flagged.
- **Primary action:** open medication detail. **Secondary:** add medication, filter (current/paused), history, doctor-visit mode.
- **Empty:** onboarding CTA pair (add / scan).
- **Offline:** cached list renders.
- **Analytics:** `passport_viewed {count}`. **Audit:** `medication.list_viewed` when caregiver views another's profile.
- **Acceptance:** ingredient shown for every item; same-ingredient items visually grouped.

### 10. Medication history
- **Objective:** previous/stopped/completed medicines and change log.
- **Information:** grouped by status (completed, stopped, paused-old), stop reason where recorded, date ranges, "restarted" links.
- **Primary action:** view detail. **Secondary:** re-add as current (requires confirmation of prescriber instruction).
- **Empty:** "No previous medicines recorded."
- **Analytics:** `history_viewed`. **Audit:** reads audited for caregiver access.
- **Acceptance:** restart flow never auto-copies old schedule without explicit confirmation.

## Adding medication

### 11. Add medication (chooser)
- **Objective:** route to the easiest capture method: Search / Scan prescription / Upload file / Manual entry / Voice / Previous medicines.
- **Primary action:** Scan prescription (largest). **Secondary:** the rest.
- **Unsupported:** camera unavailable → upload promoted; mic unavailable → voice hidden.
- **Analytics:** `add_method_selected {method}`.
- **Acceptance:** each method reachable in one tap; unavailable methods explain why.

### 12. Search medication
- **Objective:** find a product by brand, generic, or ingredient with minimal typing.
- **Information:** type-ahead results: brand, ingredients, strength, form, manufacturer; "can't find it → manual entry" escape.
- **Primary action:** select product. **Secondary:** manual entry.
- **Empty (no results):** manual-entry CTA + note that catalog grows.
- **Offline:** disabled with explanation (catalog is server-side in MVP).
- **Analytics:** `medication_search {result_count_bucket}` (query text never sent to analytics). **Audit:** none (catalog is non-PHI) until added to patient.
- **Security:** rate-limited endpoint (Cloudflare + app).
- **Acceptance:** 3-character query returns results < 1 s on 3G; works with hi/te/ur transliterated brand names where catalog provides aliases.

### 13. Scan prescription
- **Objective:** camera capture of prescriptions/strips/boxes/bottles.
- **Information:** live viewfinder, framing guide, tips (flatten page, good light), multi-page support.
- **Primary action:** capture. **Secondary:** switch to upload, add another page, retake.
- **Error:** permission denied → inline instructions + upload fallback.
- **Offline:** capture allowed; upload queues if storage permits, else prompt to retry online.
- **Unsupported:** no getUserMedia → file upload input.
- **Analytics:** `scan_started`, `scan_captured {pages}`. **Audit:** `document.capture_started` server-side at upload authorization.
- **Security:** image never leaves device except via presigned upload; local copy cleared after confirmed upload.
- **Acceptance:** works in Chrome Android, Safari iOS; fallback verified with camera denied.

### 14. Upload prescription
- **Objective:** file-picker path (PDF/JPG/PNG/HEIC).
- **Information:** allowed types and max size stated up front.
- **Primary action:** choose file. **Secondary:** switch to camera.
- **Error:** type/size rejection with plain explanation (validated client-side and server-side).
- **Analytics:** `upload_selected {type}`. **Audit:** `document.upload_authorized`.
- **Acceptance:** oversized file rejected before network transfer.

### 15. Upload progress
- **Objective:** show direct-to-R2 upload progress with resilience.
- **Information:** per-file progress, cancel, retry.
- **Error:** lost connectivity mid-upload → resumable retry with same pending document (idempotent).
- **Analytics:** `upload_completed {duration_bucket}`, `upload_failed {reason_code}`. **Audit:** `document.upload_completed` (server verification, not client claim).
- **Security:** presigned URL scoped to object+operation, short expiry; completion verified server-side (checksum/type/size).
- **Acceptance:** duplicate completion reports are idempotent.

### 16. Processing status
- **Objective:** honest async status while OCR runs.
- **Information:** state (queued/processing/needs review/failed), expected wait, "we'll notify you" when notifications enabled.
- **Primary action:** review when ready. **Secondary:** leave and continue elsewhere.
- **Error:** processing failure → apologize + manual entry path; original image kept.
- **Analytics:** `processing_status_viewed {state}`. **Audit:** job transitions audited server-side.
- **Acceptance:** user can navigate away and return without losing state.

### 17. Review extracted prescription
- **Objective:** human confirmation of every extracted field — the safety-critical screen.
- **Information:** original image (zoomable) side-by-side/stacked with per-field candidates: detected text, proposed interpretation, **confidence indicator**, uncertainty highlighting; abbreviations expanded ("1-0-1 → morning and night, one tablet each").
- **Primary action:** confirm field / confirm all reviewed. **Secondary:** edit field, mark unreadable, discard.
- **Error:** low-confidence fields cannot be bulk-confirmed; must be individually reviewed.
- **Offline:** review of already-downloaded extraction allowed; confirmation queues.
- **Analytics:** `extraction_field_corrected {field, confidence_bucket}` (feeds OCR correction rate). **Audit:** `extraction.field_confirmed {who, when, original_preserved}`.
- **Security:** original and confirmed values both persisted; confirmer identity recorded.
- **Acceptance:** impossible to save a medication from extraction without explicit per-field confirmation; original value viewable afterwards.

### 18. Confirm instructions (manual + post-extraction)
- **Objective:** structured, typed capture of dose/frequency/timing/food/duration.
- **Information:** pickers (no free text needed): quantity per dose, frequency (OD/BD/TDS/QID/SOS/HS + 1-0-1 pattern grid + alternate-day/weekly), before/with/after food, start date, duration/end date, PRN toggle, prescriber, patient-specific reason ("What did the doctor say this is for?" — optional, clearly patient-reported).
- **Primary action:** Save medicine. **Secondary:** back, save as draft.
- **Analytics:** `medication_saved {method}`. **Audit:** `medication.created {source, confirmed_by}`.
- **Acceptance:** all spec §6 dosage patterns expressible; ambiguous combos (e.g. SOS + fixed schedule) blocked with explanation.

## Understanding medicines

### 19. Medication explanation (detail)
- **Objective:** answer questions 2–11 for one medicine.
- **Information:** brand, ingredients, class, **"Commonly used for"** and **"Your recorded prescription says it was prescribed for"** as separate labeled blocks, how to take, common side effects, serious warning signs, food/alcohol notes, interaction summary, approved missed-dose guidance, pregnancy/breastfeeding warnings where applicable, storage, source + content version + review status + last-reviewed date.
- **Primary action:** Read aloud. **Secondary:** Explain simply / Tell me more / Show clinical details; edit; pause/stop (with "talk to your doctor first" interstitial); share.
- **Error (no approved content):** the exact fallback string: "Reliable medication-safety information is not available for this medicine. Please confirm with a doctor or pharmacist."
- **Offline:** cached content renders with content-version note.
- **Analytics:** `explanation_depth_used {level}`, `read_aloud_used`. **Audit:** caregiver reads audited.
- **Acceptance:** the two "used for" blocks never merge; content provenance always visible.

### 20. Read-aloud medication explanation
- **Objective:** TTS playback of the explanation at the current disclosure level.
- **Information:** play/pause, speed, sentence highlighting where supported.
- **Unsupported:** Web Speech API absent for locale → downloadable server-generated audio (Stage 8) or graceful "not available in this browser" + text remains.
- **Analytics:** `tts_played {locale, duration_bucket}`. **Audit:** none beyond read audit.
- **Acceptance:** hi/te/ur voices verified per browser matrix; visual content never depends on audio.

## Safety

### 21. Safety review result
- **Objective:** list all findings for the profile with severity and status.
- **Information:** finding cards: medicines involved, concern type (one of the 12 categories), severity, one-line plain-language summary, status (needs review / reviewed / resolved).
- **Primary action:** open finding. **Secondary:** filter, view resolved history.
- **Empty:** "No safety concerns found. This does not guarantee there are none — always tell your doctor everything you take."
- **Analytics:** `finding_opened {category, severity}`. **Audit:** `finding.viewed`, `finding.action {action}`.
- **Acceptance:** empty state never claims safety is guaranteed.

### 22. Duplicate ingredient warning
- **Objective:** explain a duplicate-ingredient finding safely.
- **Information:** both/all products with the shared ingredient highlighted, strengths, prescribers, dates; the four mandatory statements ([02](02-product-principles-and-boundaries.md)); evidence source + rule version; recommended next action; approved urgent symptoms where applicable.
- **Primary action:** "I'll ask my doctor/pharmacist" (marks acknowledged). **Secondary:** add note, mark reviewed-with-professional, read aloud.
- **Analytics:** `duplicate_warning_ack {severity}`. **Audit:** `finding.acknowledged {finding_id, rule_version}`.
- **Security:** acknowledgement never hides high-severity findings permanently; they remain listed as acknowledged.
- **Acceptance:** wording contains all four mandatory statements in all locales.

### 23. Potential interaction warning
- Same template as screen 22 for drug-drug / drug-allergy / drug-condition / food / alcohol findings; shows interaction summary from validated source only, evidence citation, severity; never displays AI-generated interaction claims.
- **Acceptance:** finding traceable to source + source version + rule version + evaluation time (tap "About this warning").

## Doses & reminders

### 24. Record dose
- **Objective:** one-tap dose recording with honest states.
- **Information:** medicine, scheduled time, quantity; action sheet: Taken / Taken at another time (time picker) / Skipped / Could not take / Medicine unavailable / Experiencing a problem (routes to guidance + doctor prompt) / Snooze.
- **Offline:** full function; queued with idempotent mutation ID.
- **Analytics:** `dose_recorded {action, latency_from_due_bucket}`. **Audit:** `dose.recorded {recorder}` — caregiver recordings attributed.
- **Acceptance:** double-tap/duplicate submissions produce one event (idempotency).

### 25. Snooze reminder
- **Objective:** short deferral without losing the dose.
- **Information:** snooze options (10/30/60 min), impact note if next dose is near.
- **Analytics:** `dose_snoozed {minutes}`. **Audit:** `dose.snoozed`.
- **Acceptance:** snoozing near the next scheduled dose warns rather than silently stacking reminders.

### 26. Missed-dose state
- **Objective:** show missed doses with **approved** guidance only.
- **Information:** missed items, time since due, approved missed-dose instruction for that product (or the no-information fallback string), "contact your doctor or pharmacist if unsure".
- **Primary action:** record what actually happened. **Secondary:** dismiss with reason.
- **Analytics:** `missed_dose_viewed {count}`. **Audit:** `dose.missed_reconciled`.
- **Acceptance:** no generic "double the next dose"-style advice can ever appear; guidance is per-product approved content only.

### 27. Refill reminder
- **Objective:** warn before medicine runs out (from quantity + consumption) and at course completion.
- **Information:** days remaining estimate, refill/completion date, prescriber.
- **Primary action:** mark refilled (updates quantity). **Secondary:** adjust quantity, dismiss.
- **Analytics:** `refill_marked`. **Audit:** `medication.refill_recorded`.
- **Acceptance:** estimates labeled as estimates; antibiotics course completion distinct from refill.

## Sharing

### 28. Doctor-visit mode
- **Objective:** everything a clinician needs, dense but readable, in one screen (spec §14.6).
- **Information:** identity, allergies, conditions, current medicines (ingredients, dosages, schedules, prescribers, start dates), recently stopped/completed, recent changes, adherence summary, unresolved concerns, prescription images where permitted.
- **Primary action:** Share (→ screen 29). **Secondary:** brightness-boosted QR, print-friendly view.
- **Offline:** renders from cache — designed to work in a clinic with no signal.
- **Analytics:** `doctor_visit_mode_opened`. **Audit:** `share.visit_mode_opened`.
- **Acceptance:** readable at arm's length; loads offline.

### 29. Share medication passport
- **Objective:** consented, controlled sharing.
- **Information:** method (QR / time-limited link / PDF / WhatsApp text summary), **selective sharing** checklist (sections to include), expiry picker, optional one-time verification, active shares list with access log and revoke buttons.
- **Primary action:** create share. **Secondary:** revoke, view access history.
- **Analytics:** `share_created {method, sections_count, expiry_bucket}`. **Audit:** `share.created/accessed/revoked/expired` — access events visible to patient.
- **Security:** share pages `no-store`, unguessable tokens, expiry enforced server-side, revocation immediate; QR contains token URL only, no PHI.
- **Acceptance:** revoked link shows a safe "no longer available" page within seconds; every access appears in patient-visible log.

## Profile & settings

### 30. Allergies
- **Objective:** maintain the allergy list feeding safety checks.
- **Information:** allergies with reaction notes and source (patient-reported / from document); prominence of severe entries.
- **Primary action:** add allergy (search + common list, minimal typing). **Secondary:** edit, mark inactive.
- **Analytics:** `allergy_added`. **Audit:** `allergy.created/updated` → triggers safety re-evaluation.
- **Acceptance:** adding an allergy re-runs safety review (visible in Concerns).

### 31. Conditions
- Same pattern as Allergies for conditions; feeds drug-condition checks; patient-reported provenance labeled.

### 32. Notification preferences
- **Objective:** channel management: in-app, browser push, SMS, WhatsApp, email, caregiver escalation — each with explicit consent state.
- **Information:** per-channel status (enabled/needs permission/needs consent/unsupported in this browser), quiet hours.
- **Primary action:** toggle channel (triggers consent or browser permission flow with pre-permission explanation).
- **Unsupported:** push unavailable (e.g. iOS Safari uninstalled) → explained, SMS/WhatsApp promoted.
- **Analytics:** `channel_toggled {channel, state}`. **Audit:** `consent.channel_granted/revoked`.
- **Acceptance:** SMS/WhatsApp never enabled without explicit consent record; browser denial handled with recovery instructions.

### 33. Reminder privacy preferences
- **Objective:** control what reminder text reveals (spec §10).
- **Information:** options — "Medicine reminder" / "Time to take your scheduled medicine" / full medication name / custom wording — with live preview of a lock-screen notification and SMS.
- **Analytics:** `reminder_privacy_set {mode}`. **Audit:** `preference.reminder_privacy_changed`.
- **Acceptance:** default is privacy-safe (no medication names); full names require explicit opt-in.

### 34. Consent management
- **Objective:** single place to see and control every consent: data processing, channels, caregivers, shares, AI processing.
- **Information:** consent list with purpose, scope, grant date, expiry, status; revoke controls; link to consent event history.
- **Analytics:** `consent_viewed`, `consent_revoked {type}`. **Audit:** `consent.revoked` + downstream enforcement events.
- **Acceptance:** revocation takes effect server-side immediately and is reflected in dependent features (e.g. SMS stops).

### 35. Active sessions
- **Objective:** see and revoke devices/sessions.
- **Information:** device descriptions, last active, current-session marker.
- **Primary action:** revoke session. **Secondary:** revoke all others.
- **Audit:** `auth.session_revoked {by}`.
- **Acceptance:** revoked session's next request fails and its local data is cleared on next open ([15-offline-sync-strategy](15-offline-sync-strategy.md)).

### 36. Offline and synchronization status
- **Objective:** honest sync visibility (spec §19): Online / Offline / Synchronizing / Synchronization failed / Changes pending / Last synchronized time.
- **Information:** pending mutation count in plain words ("2 doses waiting to sync"), retry button, per-item error details on failure.
- **Analytics:** `sync_status_viewed {state}`. **Audit:** conflict resolutions audited server-side.
- **Acceptance:** a failed mutation is never silently dropped; user sees and can retry or discard with confirmation.

### 37. Add-to-home-screen education
- **Objective:** optional, dismissible explanation of installing the PWA.
- **Information:** benefits, platform-specific steps (Android prompt / iOS Safari share-sheet instructions), "No thanks — keep using in browser" equally prominent.
- **Unsupported:** no install prompt available → instructions or hide.
- **Analytics:** `a2hs_shown/accepted/dismissed`.
- **Acceptance:** never blocks or nags; shown at most rarely and only after value delivered.

### 38. Browser-permission education
- **Objective:** pre-permission explanation before every browser prompt (camera, mic, notifications).
- **Information:** why the permission helps, what happens on denial (the fallback), how to change later.
- **Acceptance:** actual browser prompt only fires after user taps "Continue"; denial path verified for each permission.

### 39. Data export
- **Objective:** patient-initiated export (DPDP right).
- **Information:** what's included, format (PDF + machine-readable), async generation notice, download expiry.
- **Primary action:** request export → notified when ready → download via short-lived private link.
- **Analytics:** `export_requested/downloaded`. **Audit:** `data.export_requested/generated/downloaded`.
- **Security:** re-authentication required; link short-lived, single-profile scoped, no-store.
- **Acceptance:** export contains original + confirmed values and consent history.

### 40. Account deletion
- **Objective:** deletion request with informed consent and grace period.
- **Information:** what is deleted (records, images, shares), what may be retained and why (legal/audit obligations, plainly stated), grace period, irreversibility after grace.
- **Primary action:** request deletion (re-auth + explicit confirmation phrase-free — big red confirm after OTP). **Secondary:** export first (promoted), cancel during grace.
- **Analytics:** `deletion_requested/cancelled`. **Audit:** `data.deletion_requested/cancelled/executed`.
- **Acceptance:** coordinated deletion covers PostgreSQL + R2 + shares + caches per [13.6 lifecycle](26-cloudflare-edge-and-r2-architecture.md); caregiver relationships notified.

### 41. Help / Emergency-information screen
- **Help — Objective:** searchable plain-language help, contact/support path, tutorial replays; public, works pre-auth.
- **Emergency information — Objective:** patient-maintained emergency card: blood group (optional), severe allergies, critical medicines, emergency contact — accessible quickly from Profile; clearly patient-controlled.
- **Information (emergency):** the card + "In an emergency call 112 / your doctor" — the app never provides emergency medical instructions beyond approved content.
- **Security (emergency):** optional lock-screen-style quick access is opt-in only (it exposes PHI by design; consent recorded).
- **Analytics:** `help_topic_viewed {topic}` / `emergency_card_viewed`. **Audit:** `emergency.card_viewed` when accessed via share/caregiver.
- **Acceptance:** emergency card readable in < 2 taps from app open when enabled; opt-in consent recorded.

---

## Cross-screen acceptance pack

1. Every screen passes the shared-defaults acceptance criteria.
2. No URL, analytics event, or log line contains medication names, patient names, or other PHI.
3. Every clinical surface carries the four mandatory warning statements where a finding is shown.
4. Every screen renders in en/hi/te/ur including RTL Urdu without layout breakage.
5. Every capability-dependent screen (13, 15, 20, 32, 37, 38) verified against the [browser matrix](32-browser-capability-and-fallback-matrix.md) fallbacks.
