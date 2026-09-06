import type { Logger } from "pino";

/**
 * Product analytics events (docs_v2/14 §6, roadmap §33) — measured without
 * clinical data. Every event carries only opaque ids, enums, counts and
 * durations. The catalogue is closed: an event outside it is a type error,
 * and `emitProductEvent` refuses any property whose name looks like PHI.
 *
 * Transport today: one structured pino line (`event: "product"`) that the
 * log drain forwards; the OTLP exporter (ticket 0.23) replaces the sink
 * without changing call sites.
 */

export const PRODUCT_EVENTS = {
  // Acquisition
  "acquisition.registration": { source: "string?" },
  "acquisition.sign_in": { method: "enum:otp|device_trust", deviceKind: "string?" },
  "acquisition.profile_created": { kind: "enum:self|dependent" },
  "acquisition.onboarding_completed": { durationMs: "number?" },
  "acquisition.referral": { channel: "enum:clinic|pharmacy|lab|website|other" },
  // Activation
  "activation.medicine_added": { via: "enum:search|manual|extraction|previous|import|proposal" },
  "activation.prescription_uploaded": { pageCount: "number?" },
  "activation.first_test_recorded": {},
  "activation.first_measurement": { concept: "string" },
  "activation.caregiver_added": { scopeCount: "number" },
  // Engagement
  "engagement.dose_recorded": { action: "string", offline: "boolean" },
  "engagement.measurement_recorded": { concept: "string", hasContext: "boolean" },
  "engagement.document_uploaded": { kind: "string", pageCount: "number" },
  "engagement.timeline_viewed": { itemCount: "number", filtered: "boolean" },
  "engagement.report_added": { kind: "string", hasEncounter: "boolean" },
  // Network effects
  "network.share_created": { sectionCount: "number", audience: "string?", expiresInHours: "number?" },
  "network.share_opened": { result: "enum:success|expired|revoked|not_found" },
  "network.caregiver_invited": {},
  "network.caregiver_accepted": {},
  "network.proposal_accepted": { kind: "string", declinedLines: "number" },
  "network.clinic_onboarded": {},
  "network.pharmacy_onboarded": {},
  // ABDM
  "abdm.abha_linked": {},
  "abdm.records_discovered": { count: "number" },
  "abdm.records_linked": { count: "number" },
  "abdm.records_retrieved": { count: "number" },
  "abdm.consent_flow_completed": { outcome: "enum:granted|denied|revoked|expired" },
  // Safety (counts only; never the finding content)
  "safety.finding_shown": { category: "string", severity: "string" },
  "safety.finding_actioned": { action: "string" },
  // Document intelligence
  "docs.candidate_reviewed": { targetEntity: "string", targetField: "string", decision: "enum:confirmed|corrected|rejected", confidenceBucket: "enum:high|medium|low" },
} as const;

export type ProductEventName = keyof typeof PRODUCT_EVENTS;

export interface ProductEvent<N extends ProductEventName = ProductEventName> {
  name: N;
  /** Opaque ids only. */
  userId?: string;
  profileId?: string;
  organizationId?: string;
  correlationId?: string;
  properties?: Record<string, string | number | boolean | null>;
}

/** Property names that can never appear on a product event, whatever the value. */
const FORBIDDEN_PROPERTY = /(name|phone|otp|token|address|label|reason|note|text|value|result|dose|medicine|drug|diagnos|allerg|condition|email)/i;

export class ProductEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductEventError";
  }
}

/**
 * The closed-catalogue check. Two layers, in this order: a PHI-looking name
 * is refused with a message that says why (so a reviewer sees the real
 * problem), then anything the event does not declare is refused too — the
 * stored `properties` JSON (docs_v2/06 P1-7) may only ever hold keys the
 * catalogue lists, so a new dimension is a reviewed catalogue edit, never a
 * call-site improvisation. Values are scalars only, strings capped at 64.
 */
export function validateProductEvent(event: ProductEvent): void {
  if (!isProductEventName(event.name)) throw new ProductEventError(`Unknown product event "${event.name}"`);
  const declared: Record<string, string> = PRODUCT_EVENTS[event.name];
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (FORBIDDEN_PROPERTY.test(key) && !(key in declared)) {
      throw new ProductEventError(`Property "${key}" is not allowed on product events (PHI-looking name)`);
    }
    if (!Object.prototype.hasOwnProperty.call(declared, key)) {
      throw new ProductEventError(`Property "${key}" is not declared for "${event.name}" in the product event catalogue`);
    }
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new ProductEventError(`Property "${key}" must be a scalar`);
    }
    if (typeof value === "string" && value.length > 64) {
      throw new ProductEventError(`Property "${key}" is too long for an analytics dimension (max 64 chars)`);
    }
  }
}

/** True when `name` is in the catalogue — the runtime twin of the `ProductEventName` type. */
export function isProductEventName(name: string): name is ProductEventName {
  return Object.prototype.hasOwnProperty.call(PRODUCT_EVENTS, name);
}

export function emitProductEvent(logger: Logger, event: ProductEvent): void {
  validateProductEvent(event);
  logger.info(
    {
      event: "product",
      productEvent: event.name,
      userId: event.userId,
      profileId: event.profileId,
      organizationId: event.organizationId,
      correlationId: event.correlationId,
      props: event.properties ?? {},
    },
    "product event",
  );
}
