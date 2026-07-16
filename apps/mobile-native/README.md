# mobile-native (placeholder)

Native Android (Stage 9) and iOS (Stage 10) applications — React Native + Expo.

**Deliberately empty during the MVP** (docs/08-native-mobile-roadmap.md): native
development does not begin until the PWA foundation and APIs are stable.

When built, this app must:

- Use the same Railway backend APIs (`@medpass/api-client`), domain model,
  clinical-safety services, auth/consent framework, and sync contract
  (`@medpass/offline-sync`) as the PWA.
- Contain **no separate or conflicting medication-safety logic** — findings are
  rendered, never computed, on the client.
- Reuse `@medpass/domain`, `@medpass/validation`, `@medpass/localization`,
  and `@medpass/design-tokens`.
