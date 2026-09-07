import { z } from "zod";
import {
  MEASUREMENT_DEVICE_KINDS,
  MEASUREMENT_DEVICE_PLATFORMS,
  OBSERVATION_CONCEPTS,
  OBSERVATION_CONTEXTS,
  OBSERVATION_INTERPRETATIONS,
  TREND_BUCKETS,
  TREND_WINDOWS,
} from "@medpass/domain";

/**
 * Observations (docs_v2/04 §5, docs_v2/05 §7, ADR-V2-011) — one table for
 * every home measurement, replacing the V1 glucose / blood-pressure /
 * weight sibling tables.
 *
 * Deliberately *not* validated here: the value's range and its unit. Both
 * are per-concept facts owned by @medpass/terminology (canonical unit,
 * allowed entered units, plausibility bounds), so the service converts and
 * bounds-checks — a `z.number().min()` here would fossilise a second,
 * silently diverging copy of the same table. The schema only enforces the
 * shape: two numbers for blood pressure, one for everything else, text for
 * `other`.
 */
export const observationSchema = z
  .object({
    concept: z.enum(OBSERVATION_CONCEPTS),
    /** Systolic for blood pressure; the single value for every other concept. */
    valueNumeric: z.coerce.number().finite().optional(),
    /** Diastolic — blood pressure only. */
    valueNumeric2: z.coerce.number().finite().optional(),
    /** `other` and free-text concepts only. */
    valueText: z.string().trim().min(1).max(200).optional(),
    /** The unit as entered; converted to the concept's canonical unit by the service. */
    enteredUnit: z.string().trim().max(30).optional(),
    enteredValueText: z.string().trim().max(60).optional(),
    context: z.enum(OBSERVATION_CONTEXTS).optional(),
    bodySite: z.string().trim().max(60).optional(),
    method: z.string().trim().max(60).optional(),
    /**
     * When it was measured. A reading cannot be from the future: a mistyped
     * year filed a 2027 reading into the diary and the trends (2026-09-07 UI
     * review). Five minutes of slack covers a phone clock that runs fast.
     */
    measuredAt: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 5 * 60_000, {
      message: "That time is in the future — please check the date",
    }),
    /** Refused on a patient/caregiver path — see INTERPRETATION_NOT_CLIENT_SETTABLE. */
    interpretation: z.enum(OBSERVATION_INTERPRETATIONS).optional(),
    notes: z.string().trim().max(500).optional(),
    /** One of this profile's `MeasurementDevice` rows; also the dedupe key for batch sync. */
    deviceId: z.string().uuid().optional(),
    /** Offline replay key (docs/15) — a repeat of the same id is the same row. */
    clientMutationId: z.string().trim().min(1).max(80).optional(),
    encounterId: z.string().uuid().nullable().optional(),
    /**
     * Blood pressure only: the pulse the same cuff reported. Stored as its
     * own `heart_rate` observation in the same transaction, mirroring the V1
     * `BloodPressureReading.pulseBpm` column (ADR-V2-011).
     */
    pulseBpm: z.coerce.number().finite().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.concept === "blood_pressure") {
      if (v.valueNumeric === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueNumeric"], message: "Enter the systolic (upper) number" });
      }
      if (v.valueNumeric2 === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueNumeric2"], message: "Enter the diastolic (lower) number" });
      }
      return;
    }
    if (v.valueNumeric2 !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueNumeric2"], message: "Only blood pressure has a second number" });
    }
    if (v.pulseBpm !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pulseBpm"], message: "Record a pulse on its own as a heart_rate observation" });
    }
    if (v.concept === "other") {
      if (!v.valueText) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueText"], message: "Say what was measured and what it read" });
      }
      return;
    }
    if (v.valueNumeric === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valueNumeric"], message: "Enter the reading" });
    }
  });
export type ObservationInput = z.infer<typeof observationSchema>;

/**
 * Device sync (docs_v2/05 §7). A glucometer handed over after a fortnight
 * abroad arrives as one call, not 200. Deduped on
 * `(concept, measuredAt, deviceId)` — both against rows already stored and
 * within the batch itself, so a retried upload is a no-op rather than a
 * doubled diary.
 */
export const observationBatchSchema = z.object({
  /** Applied to every item that doesn't name its own device. */
  deviceId: z.string().uuid().optional(),
  items: z.array(observationSchema).min(1).max(500),
});
export type ObservationBatchInput = z.infer<typeof observationBatchSchema>;

export const observationsQuerySchema = z.object({
  concept: z.enum(OBSERVATION_CONCEPTS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  deviceId: z.string().uuid().optional(),
});
export type ObservationsQuery = z.infer<typeof observationsQuerySchema>;

/** `?window=7d|30d|90d&bucket=day|week|month` (docs_v2/05 §7). */
export const observationTrendQuerySchema = z.object({
  window: z.enum(TREND_WINDOWS).default("30d"),
  bucket: z.enum(TREND_BUCKETS).default("day"),
});
export type ObservationTrendQuery = z.infer<typeof observationTrendQuerySchema>;

/**
 * A device the patient measures with (docs_v2/04 §5.4). No serial number is
 * ever stored in the clear — `serialDigest` is a hash the client computes,
 * enough to recognise the same meter twice and useless to anyone else.
 */
export const measurementDeviceSchema = z.object({
  kind: z.enum(MEASUREMENT_DEVICE_KINDS),
  platform: z.enum(MEASUREMENT_DEVICE_PLATFORMS).default("manual"),
  manufacturer: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  serialDigest: z.string().trim().max(128).optional(),
  label: z.string().trim().max(80).optional(),
});
export type MeasurementDeviceInput = z.infer<typeof measurementDeviceSchema>;

export const updateMeasurementDeviceSchema = measurementDeviceSchema.partial().extend({
  status: z.enum(["active", "retired"]).optional(),
});
export type UpdateMeasurementDeviceInput = z.infer<typeof updateMeasurementDeviceSchema>;
