# 08 — Native Mobile Roadmap

Native apps are **later phases** (spec §3, Stages 9–10). `apps/mobile-native` remains a placeholder during the MVP. Native development does not begin until the PWA foundation and APIs are stable, unless a critical requirement cannot be met through the PWA (documented via ADR).

## Why native, eventually

The PWA has documented ceilings ([32-browser-capability-and-fallback-matrix](32-browser-capability-and-fallback-matrix.md)): reminder reliability depends on browser push support and OS battery policies; background sync is inconsistent; biometrics and hardware-backed encrypted storage are unavailable or limited. Native apps address exactly these — nothing else justifies them.

## Phase 2 — Android (Stage 9)

**Entry gate:** MVP validated (primary metric: patients safely using the browser product) + measured PWA reminder-delivery shortfall documented.

Build: React Native + Expo in `apps/mobile-native`, reusing `packages/domain`, `api-client`, `validation`, `localization`, `design-tokens`, `offline-sync`, `config`.

Deliverables:
1. Native push notifications (FCM) driven by the same Railway reminder scheduler — the server remains the source of truth for schedules and delivery status.
2. Background synchronization (WorkManager) using the same offline mutation contract.
3. Biometric authentication (BiometricPrompt) as *re-entry* convenience layered on the same session model.
4. Encrypted storage (Android Keystore-backed) for local caches.
5. Camera improvements (document edge detection, multi-page capture) feeding the same upload-authorization flow.
6. Accessibility integration (TalkBack parity with the PWA's screen-reader support).
7. Deep links / App Links to the same URL space.
8. API-compatibility validation suite: the contract tests in [20-testing-strategy](20-testing-strategy.md) run against the native client build.
9. Play Store release: listing, data-safety form, staged rollout, crash reporting (PHI-free).

**Hard rules:** same backend APIs; **no separate or conflicting medication-safety logic**; clinical evaluation stays on Railway; native app renders findings, never computes them.

## Phase 3 — iOS (Stage 10)

**Entry gate:** product adoption and business justification recorded in an ADR.

Deliverables: iOS target on the same RN codebase; APNs push via the same scheduler; Face ID/Touch ID re-entry; Keychain/Data Protection encrypted storage; VoiceOver accessibility validation; App Store release (privacy nutrition labels, review-guideline compliance for medical apps — positioning language from [02](02-product-principles-and-boundaries.md) applies verbatim).

## Success comparators (spec §27)

Track from day one of Phase 2: Android conversion rate after Phase 2; **native reminder reliability compared with PWA reminders**; adherence deltas between platforms. The PWA remains fully supported — installation is never required for access.

## Status

Everything in this document: **Deferred to Android phase / Deferred to iOS phase** in [22-implementation-plan](22-implementation-plan.md).
