# Vendor & Subprocessor Register

Per docs/18 §Vendor & subprocessor register. Created at first vendor onboarding (Telnyx, this session) — one row per vendor, kept current as each is actually connected. "Not yet onboarded" rows are placeholders for vendors this project anticipates (docs/24 open decisions) but hasn't connected an account for.

| Vendor | Service | Data shared | Region | Contract/DPA status | Retention | Training-use (AI) | Exit strategy |
|---|---|---|---|---|---|---|---|
| Telnyx | SMS (OTP delivery, dose/refill/completion reminder text) | Phone number (E.164) + message text (never the OTP code's context, never the medicine name unless the patient opted into `full_name` wording) | US (account checked this session has one US toll-free number; no other region configured) | Not yet reviewed — **Requires legal review** before production use (DPA status unconfirmed) | Message content/metadata retention governed by Telnyx's own policy, not this app's retention crons; this app stores only the delivery attempt's status/error digest, never the message text, in `notification_attempts` | Not applicable — SMS is not an AI/ML service | Swappable: both `OtpSender` and `SmsMessageSender` are interfaces (`@medpass/notifications`); a different vendor is a new adapter class, no call-site changes |
| Railway | Compute + PostgreSQL hosting | All application data (full PHI) | Not yet provisioned — docs/24 OD-5 assumes Singapore, unmeasured | Not yet provisioned | N/A | N/A | Documented in docs/25 (Railway deployment architecture) |
| Cloudflare | Edge/WAF + R2 object storage | Prescription document files (encrypted at rest), edge traffic metadata | Not yet provisioned | Not yet provisioned | N/A | N/A | Local-disk stand-in in use instead (ADR-12); R2 swap is a config change to the same `ObjectStorage` interface |
| WhatsApp BSP (OD-10) | WhatsApp reminder delivery | Not yet onboarded | — | — | — | — | — |
| OCR provider (OD-11) | Handwriting/Indic-script OCR | Not yet onboarded (Tesseract.js runs locally instead — no vendor, no data leaves the app) | — | — | — | — | — |
| AI provider (OD-12) | Content simplification/translation | Not yet onboarded | — | — | — | — | — |
| Licensed drug DB (OD-3/4) | Interaction/contraindication data | Not yet onboarded | — | — | — | — | — |
