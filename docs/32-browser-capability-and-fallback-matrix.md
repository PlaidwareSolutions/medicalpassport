# 32 — Browser Capability and Fallback Matrix

Rule: **never assume a capability; detect it, and always provide the documented fallback** (spec §9). The PWA must remain usable without installation and without any optional capability.

Target browsers (test matrix per [20-testing-strategy](20-testing-strategy.md)): Chrome on Android, Samsung Internet, Safari on iPhone, Chrome on desktop, Edge on desktop, Firefox where practical.

| Capability | Chrome Android | Samsung Internet | Safari iOS | Desktop Chrome/Edge | Detection | Fallback |
|---|---|---|---|---|---|---|
| Add to home screen / install prompt | ✅ `beforeinstallprompt` | ✅ | ⚠️ manual (share sheet); no prompt event | ✅ | `beforeinstallprompt` listener + `display-mode` | Continue as normal website; optional manual instructions (screen 37) |
| Service worker + offline shell | ✅ | ✅ | ✅ | ✅ | `('serviceWorker' in navigator)` | Online-only mode with clear messaging |
| Web Push notifications | ✅ | ✅ | ⚠️ only when installed to home screen (16.4+) | ✅ | `('PushManager' in window)` + permission state | **SMS / WhatsApp reminders (consented)** + in-app reminders |
| Notification sound/vibration/persistence | ⚠️ Android notification-channel settings can override the app's requested sound/vibration | ⚠️ same as Chrome Android | ⚠️ own persistence behavior, `vibrate` unsupported on iOS | ⚠️ auto-dismisses without `requireInteraction: true`; no `vibrate` support (no vibration hardware) | `silent`/`vibrate`/`requireInteraction` options on `showNotification()` | If the OS/user silenced or overrode it, the in-app chime + Home's due-now color cue are the fallback once the app is open (below) |
| In-app chime (Web Audio API) | ✅ after a user gesture | ✅ after a user gesture | ✅ after a user gesture | ✅ after a user gesture | try/catch around `AudioContext` construction | Requires ≥1 click/tap/key on the page since load (browser autoplay policy) — a completely untouched tab may not chime on the first attempt; the OS push notification remains the reliable channel regardless |
| Background Sync API | ✅ | ✅ | ❌ | ✅ | `('sync' in registration)` | Retry queued mutations on app open / visibility change / online event |
| Periodic Background Sync | ⚠️ installed only | ⚠️ | ❌ | ⚠️ | feature check | Server-side scheduling + SMS; refresh on open |
| Camera (`getUserMedia`) | ✅ | ✅ | ✅ | ✅ | permission + device enumeration | `<input type="file" accept="image/*" capture>` then plain file upload |
| File upload | ✅ | ✅ | ✅ | ✅ | — | Always available; baseline capture path |
| Microphone / speech recognition | ✅ (Web Speech partial) | ⚠️ | ⚠️ limited locales | ✅ | API + locale check | Manual entry with pickers (already typing-minimal) |
| Text-to-speech (Web Speech synthesis) | ✅ (voice availability varies by locale) | ✅ | ✅ (locale gaps for te/ur) | ✅ | `speechSynthesis.getVoices()` per locale (`lib/read-aloud.ts`: async `voiceschanged` + first-interaction re-poll) | **Built:** static guidance copy plays build-time pre-generated audio (`generate:audio`, committed under `public/audio/guidance/`) on every browser incl. te/ur Safari; dynamic content uses a locale-matched browser voice with `lang` set (Latin-only text may use an English voice); when neither exists the listen button renders nothing — text always primary |
| IndexedDB | ✅ | ✅ | ✅ (evictable; private browsing limits) | ✅ | open test + quota estimate | Online-only behavior with clear message |
| Storage persistence (`navigator.storage.persist`) | ✅ | ✅ | ⚠️ | ✅ | API check | Warn that offline data may be evicted; sync eagerly |
| Web Share / Share target | ✅ | ✅ | ✅ share; target when installed | ⚠️ | `navigator.share` | Copy-link button, download PDF |
| WebOTP (SMS autofill) | ✅ | ⚠️ | ⚠️ (Safari has its own autofill) | ❌ | `('OTPCredential' in window)` | Manual 6-digit entry with large inputs |
| Badging API | ✅ installed | ⚠️ | ⚠️ | ✅ | check | In-app badge counts only |
| Wake lock / alarms | ⚠️ no true alarms | ⚠️ | ❌ | ⚠️ | — | **Server-driven reminders (push/SMS/WhatsApp)**; never rely on client timers |
| QR scan (BarcodeDetector) | ✅ | ⚠️ | ❌ | ⚠️ | `('BarcodeDetector' in window)` | JS-decoder fallback library, or manual code entry |

⚠️ = partial/conditional. This matrix is re-verified each release; automated capability tests in CI cover the detection code paths, manual device passes cover real behavior.

## Mandated fallback pairs (spec §9)

1. Browser push unavailable → **offer SMS or WhatsApp reminders** (explicit consent, [16](16-reminder-and-notification-strategy.md)).
2. Background sync unavailable → **retry when the application reopens** (and on `online`/visibility events).
3. Camera unavailable/denied → **file upload**.
4. Add-to-home-screen unavailable → **continue as a normal website**.
5. Microphone unavailable → **manual entry**.
6. Offline storage unavailable (private browsing, quota, eviction) → **clear online-only behavior**, no silent data loss.

## Degradation tiers

- **Tier A (full):** installed PWA, push, background sync, camera, TTS.
- **Tier B (typical mobile browser):** uninstalled, no push (iOS Safari) → SMS/WhatsApp reminders, open-triggered sync.
- **Tier C (constrained):** no service worker / private browsing / storage denied → fully online website; all clinical content and dose recording still work while connected.

Every feature ships only after its behavior in all three tiers is specified and tested. Low-bandwidth mode (reduced images, deferred non-critical fetches) applies to all tiers via `Save-Data` header and connection heuristics.
