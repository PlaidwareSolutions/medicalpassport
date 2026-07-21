import { z } from "zod";

export const NodeEnv = z.enum(["development", "test", "staging", "production"]);
export type NodeEnv = z.infer<typeof NodeEnv>;

/**
 * Parses environment variables against a schema and fails fast with a
 * readable list of problems. Secrets must never have silent defaults.
 */
export function loadEnv<T extends z.ZodRawShape>(
  shape: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const parsed = z.object(shape).safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const apiEnvShape = {
  NODE_ENV: NodeEnv.default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  /** Pepper mixed into OTP hashes. Required in every environment. */
  OTP_HASH_PEPPER: z.string().min(16),
  /** Pepper mixed into session token hashes. */
  SESSION_TOKEN_PEPPER: z.string().min(16),
  /** AES-256 key (base64, 32 bytes) for application-level field encryption. */
  FIELD_ENCRYPTION_KEY: z.string().min(32),
  /**
   * OTP transport. "log" is a development-only fake; the API refuses to boot
   * with it in production. "voice" (docs/16, OD-10) is a supplementary
   * channel alongside "sms" — not a replacement, and not a confirmed way
   * around India's SMS DLT requirement (TRAI's rules also cover automated
   * voice/IVR traffic).
   */
  OTP_TRANSPORT: z.enum(["log", "sms", "voice"]).default("log"),
  /** Development/test only: fixed OTP code so no real SMS is needed. */
  OTP_DEV_FIXED_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** Comma-separated allowlist of public hostnames (host-header defense). */
  ALLOWED_HOSTS: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Local-disk object-storage dev stand-in for Cloudflare R2 (docs/24
   * ADR-12, docs/26) — used whenever the R2_* vars below aren't all set.
   */
  OBJECT_STORAGE_ROOT: z.string().default(".dev-data/object-storage"),
  OBJECT_STORAGE_BASE_URL: z.string().url().optional(),
  /**
   * Real Cloudflare R2 (docs/26 §13, Stage 11 follow-up). All four optional
   * and only meaningful together — `createObjectStorage` falls back to the
   * local-disk stand-in above unless every one of them is set.
   * R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY are derived from a Cloudflare API
   * token scoped to *only* Workers R2 Storage (never a broader token —
   * that credential lives in the running app, so least-privilege matters).
   */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PREFIX: z.string().optional(),
  /**
   * Web Push (docs/16) — self-signed VAPID keypair, no external provider or
   * account needed (unlike SMS/WhatsApp, which are blocked on OD-10).
   * Optional so the API still boots without push configured.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@example.com"),
  /**
   * SMS (docs/16, OD-10) — Telnyx. Optional so the API still boots without
   * it configured (OTP_TRANSPORT stays "log", SMS reminders stay
   * unavailable); required for OTP_TRANSPORT="sms" and for any SMS
   * reminder channel to actually dispatch.
   */
  TELNYX_API_KEY: z.string().optional(),
  TELNYX_FROM_NUMBER: z.string().optional(),
  /**
   * Voice OTP (docs/16, OD-10 supplementary channel) — the Call Control
   * Application/connection ID that owns TELNYX_FROM_NUMBER for outbound
   * calling. Required for OTP_TRANSPORT="voice".
   */
  TELNYX_VOICE_CONNECTION_ID: z.string().optional(),
  /**
   * Delivery-status webhooks (docs/16 follow-up): TELNYX_PUBLIC_KEY (from
   * the Telnyx portal, distinct from the API key) verifies the Ed25519
   * signature on incoming webhook calls; TELNYX_WEBHOOK_URL is the full
   * public HTTPS URL of this API's webhook endpoint
   * (`https://<host>/v1/webhooks/telnyx/sms`), passed to Telnyx on send so
   * it knows where to deliver status updates. Both optional — without them
   * SMS still sends, it just never learns the final delivery outcome.
   */
  TELNYX_PUBLIC_KEY: z.string().optional(),
  TELNYX_WEBHOOK_URL: z.string().url().optional(),
  /**
   * Cloudflare Turnstile (docs/26 §12.4, OD-15) — bot-detection on OTP
   * request (covers both "login" and "recovery" purposes; account recovery
   * shares this same endpoint, not a separate one). Optional: when unset
   * (dev/local, Cloudflare Turnstile not provisioned), verification is
   * skipped entirely rather than refused. "Managed" widget mode means
   * Cloudflare itself decides whether a visitor needs a visible challenge
   * or passes invisibly — docs/26's "challenged when suspicious", with no
   * custom suspicion-scoring needed on this side.
   */
  TURNSTILE_SECRET_KEY: z.string().optional(),
} as const;

export type ApiEnv = z.infer<z.ZodObject<typeof apiEnvShape>>;

export const workerEnvShape = {
  NODE_ENV: NodeEnv.default("development"),
  DATABASE_URL: z.string().url(),
  /**
   * Real deployments would run BullMQ against this; there's no Redis in
   * this sandbox, so the worker polls `background_jobs` in Postgres
   * instead (docs/22 Stage 7/8 follow-up) — optional here since nothing
   * requires it yet.
   */
  REDIS_URL: z.string().url().optional(),
  OBJECT_STORAGE_ROOT: z.string().default(".dev-data/object-storage"),
  /** Real R2 (docs/26 §13) — see apiEnvShape's comment; falls back to local-disk unless all four are set. */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PREFIX: z.string().optional(),
} as const;

export const cronEnvShape = {
  NODE_ENV: NodeEnv.default("development"),
  DATABASE_URL: z.string().url(),
  /** Needed by cleanup-abandoned-uploads to derive the object-storage HMAC secret. */
  FIELD_ENCRYPTION_KEY: z.string().min(32),
  OBJECT_STORAGE_ROOT: z.string().default(".dev-data/object-storage"),
  /** Real R2 (docs/26 §13) — see apiEnvShape's comment; falls back to local-disk unless all four are set. */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PREFIX: z.string().optional(),
  /** Needed by detect-due-reminders to send web push (docs/16). */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@example.com"),
  /** Needed by detect-due-reminders to send SMS reminders (docs/16, OD-10). */
  TELNYX_API_KEY: z.string().optional(),
  TELNYX_FROM_NUMBER: z.string().optional(),
  /** Passed to Telnyx on send so delivery-status webhooks reach the API (must match its TELNYX_WEBHOOK_URL). */
  TELNYX_WEBHOOK_URL: z.string().url().optional(),
} as const;

export type CronEnv = z.infer<z.ZodObject<typeof cronEnvShape>>;

/** Feature flags. Env-seeded for the MVP; a flag service can replace this. */
export interface FeatureFlags {
  readonly prescriptionUpload: boolean;
  readonly safetyFindings: boolean;
  readonly sharing: boolean;
  readonly aiExplanations: boolean;
}

export function featureFlagsFromEnv(source: NodeJS.ProcessEnv = process.env): FeatureFlags {
  const on = (key: string) => source[key] === "true";
  return {
    prescriptionUpload: on("FLAG_PRESCRIPTION_UPLOAD"),
    safetyFindings: on("FLAG_SAFETY_FINDINGS"),
    sharing: on("FLAG_SHARING"),
    aiExplanations: on("FLAG_AI_EXPLANATIONS"),
  };
}
