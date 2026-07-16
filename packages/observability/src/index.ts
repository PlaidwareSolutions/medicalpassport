import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";

export const CORRELATION_HEADER = "x-correlation-id";

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Keys that must never appear in logs (docs/12 §log hygiene). The redaction
 * list is defense in depth — code must not put these in log context at all.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.phone",
  "*.phoneE164",
  "*.otp",
  "*.code",
  "*.token",
  "*.refreshToken",
  "*.password",
  "*.presignedUrl",
  "*.displayName",
  "*.enteredName",
  "*.patientReason",
];

export function createLogger(service: string, level?: string): Logger {
  return pino({
    name: service,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
