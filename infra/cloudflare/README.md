# Cloudflare configuration (docs/26)

All items **Requires platform configuration** until the zone exists (domain: OD-1).

## DNS (proxied, strict TLS)

| Hostname | Target | Notes |
|---|---|---|
| `app.example.com` | Railway patient-web | patient + caregiver PWA |
| `api.example.com` | Railway api | |
| `admin.example.com` | Railway admin-web | optional Cloudflare Access policy |
| `share.example.com` | Railway patient-web | share routes; aggressive no-store |
| `assets.example.com` | public static assets | only CDN-cached hostname |

Settings: Full (strict) TLS · HSTS · minimum TLS 1.2 · Railway origin
hostnames never exposed to users.

## Cache rules

- `assets.example.com/*` and `*/_next/static/*`: cache everything (versioned, immutable).
- `api.example.com/*`, `share.example.com/*`, `admin.example.com/*`: **bypass cache**.
- Origin already sends `Cache-Control: private, no-store` on personalized
  responses — the edge rule is defense in depth; staging probes assert
  `CF-Cache-Status` is never HIT on sensitive routes (docs/20).

## WAF & rate limiting (docs/26 §12.3)

Managed rules ON. Custom rate limits (per IP unless noted):

| Path | Limit |
|---|---|
| `POST api.example.com/v1/auth/otp/request` | 5 / 10 min |
| `POST api.example.com/v1/auth/otp/verify` | 10 / 10 min |
| `GET api.example.com/v1/catalog/products` | 60 / min |
| `share.example.com/s/*` | 30 / min |
| `admin.example.com/*` login | 10 / 10 min |

Application-level limits stand alone (already enforced in the API) —
Cloudflare is never the only protection against OTP abuse.

## Turnstile (docs/26 §12.4)

Widgets for: web OTP request (suspicious traffic), account recovery, admin
login. Secret verified server-side (`TURNSTILE_SECRET`); completion never
authenticates by itself.

## R2 buckets (docs/26 §13)

Per environment prefix (`dev-` / `stg-` / `prod-`): `patient-docs`, `derived`,
`ocr-tmp` (48 h lifecycle), `backups`, `public-assets` (only public one).
Private buckets: access only via short-lived presigned URLs issued by the
Railway API after authorization, or backend streaming. API tokens scoped per
bucket + operation. No patient identifiers in bucket names or object keys.

## Security headers / edge

Security headers are set at origin (Next/Nest); verify at edge. Host allowlist
enforced at origin via `ALLOWED_HOSTS`. Preserve client IP via
`CF-Connecting-IP` (API trusts proxy headers only from Cloudflare ranges).
