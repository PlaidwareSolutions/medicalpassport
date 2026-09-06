import { z } from "zod";
import { ACTOR_KINDS } from "./actor.js";
import { RECORD_SOURCES } from "./record-source.js";
import { RECORDED_VIA } from "./recorded-via.js";
import { VERIFICATION_STATES } from "./verification-state.js";

/**
 * Keys of the provenance block (docs_v2/04 §1.2). These are the columns every
 * patient-clinical table carries, and the keys a client payload may never set.
 */
export const PROVENANCE_KEYS = [
  "source",
  "verification",
  "recordedVia",
  "recordedByUserId",
  "sourceDocumentId",
  "sourceExtractionId",
  "sourceDeviceId",
  "sourceAbdmTxnId",
  "sourceOrganizationId",
  "sourcePractitionerId",
  "verifiedByUserId",
  "verifiedAt",
] as const;

export type ProvenanceKey = (typeof PROVENANCE_KEYS)[number];

const uuid = z.string().uuid();

/** Zod schema for the block as it sits on a persisted row. */
export const provenanceBlockSchema = z
  .object({
    source: z.enum(RECORD_SOURCES),
    verification: z.enum(VERIFICATION_STATES),
    recordedVia: z.enum(RECORDED_VIA),
    recordedByUserId: uuid.nullable(),
    sourceDocumentId: uuid.nullable(),
    sourceExtractionId: uuid.nullable(),
    sourceDeviceId: uuid.nullable(),
    sourceAbdmTxnId: uuid.nullable(),
    sourceOrganizationId: uuid.nullable(),
    sourcePractitionerId: uuid.nullable(),
    verifiedByUserId: uuid.nullable(),
    verifiedAt: z.coerce.date().nullable(),
  })
  .strict();

export type ProvenanceBlock = z.infer<typeof provenanceBlockSchema>;

/**
 * Input shape for services stamping a new row: `source`, `verification` and
 * `recordedVia` are mandatory; every link defaults to `null`.
 */
export const provenanceBlockInputSchema = provenanceBlockSchema.extend({
  recordedByUserId: uuid.nullable().default(null),
  sourceDocumentId: uuid.nullable().default(null),
  sourceExtractionId: uuid.nullable().default(null),
  sourceDeviceId: uuid.nullable().default(null),
  sourceAbdmTxnId: uuid.nullable().default(null),
  sourceOrganizationId: uuid.nullable().default(null),
  sourcePractitionerId: uuid.nullable().default(null),
  verifiedByUserId: uuid.nullable().default(null),
  verifiedAt: z.coerce.date().nullable().default(null),
});

export type ProvenanceBlockInput = z.input<typeof provenanceBlockInputSchema>;

export const actorKindSchema = z.enum(ACTOR_KINDS);
