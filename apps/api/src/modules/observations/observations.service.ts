import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT, TREND_WINDOW_DAYS, type GlucoseReadingContext } from "@medpass/domain";
import { toLegacyBloodPressure, toLegacyGlucose, toLegacyWeight } from "./legacy-views";
import { emitHealthEvent, localIso, projectObservation, supersedeHealthEvents } from "@medpass/health-events";
import {
  LOINC_SYSTEM,
  UnitConversionError,
  getObservationConcept,
  listAllowedUnits,
  listObservationConcepts,
  toCanonicalUnit,
  type ObservationConceptEntry,
} from "@medpass/terminology";
import type {
  MeasurementDeviceInput,
  ObservationBatchInput,
  ObservationInput,
  ObservationTrendQuery,
  ObservationsQuery,
  UpdateMeasurementDeviceInput,
} from "@medpass/validation";
import type { MeasurementDevice, Observation, Prisma } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { eventCtx, profileTimezone } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { rejectClientInterpretation } from "../../common/provenance";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";
import { EncountersService } from "../encounters/encounters.service";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

type Tx = Prisma.TransactionClient;

/** The value slots one observation write lands in, already in canonical units. */
interface CanonicalValue {
  valueNumeric: string | null;
  valueNumeric2: string | null;
  unit: string;
}

function requireConcept(concept: string): ObservationConceptEntry {
  const entry = getObservationConcept(concept);
  if (!entry) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown measurement", 400, [
      { path: "concept", message: "Not a measurement this app knows" },
    ]);
  }
  return entry;
}

/** Decimal(12,3) on Observation.valueNumeric — round rather than let Prisma refuse the row. */
function round3(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

/**
 * Brings the entered value to the concept's canonical unit and checks it
 * against the concept's plausibility range.
 *
 * Both halves come from @medpass/terminology, never from a literal here: the
 * canonical unit per concept is enforced (ADR-V2-011), and the range is
 * plausibility only — "could a human plausibly have produced this number".
 * It is never a clinical threshold (docs_v2/04 §5.2, hazard H-25): SpO2 of
 * 140 is a typo and is refused; SpO2 of 80 is a real, frightening reading
 * and is stored without comment.
 */
function canonicalize(concept: ObservationConceptEntry, input: Pick<ObservationInput, "valueNumeric" | "valueNumeric2" | "enteredUnit">): CanonicalValue {
  if (concept.canonicalUnit === null) {
    // `other` only: free text, no unit, nothing to convert or bound.
    return { valueNumeric: null, valueNumeric2: null, unit: "" };
  }
  const convert = (value: number, path: string): number => {
    if (!input.enteredUnit) return value;
    try {
      return toCanonicalUnit(value, input.enteredUnit, concept.key).value;
    } catch (err) {
      if (err instanceof UnitConversionError) {
        const allowed = listAllowedUnits(concept.key).map((u) => u.display).join(", ");
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "That unit doesn't belong to this measurement", 400, [
          { path: path === "valueNumeric" ? "enteredUnit" : path, message: `Use one of: ${allowed}` },
        ]);
      }
      throw err;
    }
  };
  const bound = (value: number, range: { min: number; max: number } | null, path: string, label: string): void => {
    if (range === null) return;
    if (value < range.min || value > range.max) {
      throw new ApiProblem(
        ERROR_CODES.OBSERVATION_OUT_OF_RANGE,
        "That reading looks like a typo — please check it",
        400,
        [{ path, message: `${label} should be between ${range.min} and ${range.max} ${concept.canonicalUnitDisplay ?? ""}`.trim() }],
      );
    }
  };

  if (concept.hasTwoValues) {
    const systolicSlot = concept.components?.find((c) => c.slot === "valueNumeric");
    const diastolicSlot = concept.components?.find((c) => c.slot === "valueNumeric2");
    const systolic = convert(input.valueNumeric!, "valueNumeric");
    const diastolic = convert(input.valueNumeric2!, "valueNumeric2");
    bound(systolic, systolicSlot?.plausibility ?? concept.plausibility, "valueNumeric", systolicSlot?.display ?? "Value");
    bound(diastolic, diastolicSlot?.plausibility ?? concept.plausibility, "valueNumeric2", diastolicSlot?.display ?? "Value");
    return { valueNumeric: round3(systolic), valueNumeric2: round3(diastolic), unit: concept.canonicalUnit };
  }

  if (input.valueNumeric === undefined) {
    return { valueNumeric: null, valueNumeric2: null, unit: concept.canonicalUnit };
  }
  const value = convert(input.valueNumeric, "valueNumeric");
  bound(value, concept.plausibility, "valueNumeric", concept.display);
  return { valueNumeric: round3(value), valueNumeric2: null, unit: concept.canonicalUnit };
}

function observationDto(o: Observation) {
  const concept = getObservationConcept(o.concept);
  return {
    id: o.id,
    concept: o.concept,
    label: concept?.display ?? o.concept,
    conceptCode: o.conceptCode,
    conceptSystem: o.conceptSystem,
    // Prisma Decimal serializes as an object over JSON — stringify explicitly.
    valueNumeric: o.valueNumeric?.toString() ?? null,
    valueNumeric2: o.valueNumeric2?.toString() ?? null,
    valueText: o.valueText,
    unit: o.unit,
    enteredUnit: o.enteredUnit,
    enteredValueText: o.enteredValueText,
    context: o.context,
    bodySite: o.bodySite,
    method: o.method,
    measuredAt: o.measuredAt.toISOString(),
    measuredAtLocal: o.measuredAtLocal,
    interpretation: o.interpretation,
    notes: o.notes,
    deviceId: o.deviceId,
    encounterId: o.encounterId,
    clientMutationId: o.clientMutationId,
    legacyEntityType: o.legacyEntityType,
    legacyId: o.legacyId,
    provenanceSource: o.provenanceSource,
    verification: o.verification,
    createdAt: o.createdAt.toISOString(),
  };
}

function deviceDto(d: MeasurementDevice & { _count?: { observations: number } }) {
  return {
    id: d.id,
    kind: d.kind,
    platform: d.platform,
    manufacturer: d.manufacturer,
    model: d.model,
    label: d.label,
    status: d.status,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
    observationCount: d._count?.observations ?? undefined,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Device-sync dedupe key (docs_v2/05 §7): `(concept, measuredAt, deviceId)`. */
function dedupeKey(concept: string, measuredAt: Date, deviceId: string | null | undefined): string {
  return `${concept}|${measuredAt.toISOString()}|${deviceId ?? ""}`;
}

/**
 * Observations (docs_v2/04 §5, docs_v2/05 §7, ADR-V2-011) — one table for
 * every home measurement, replacing the V1 glucose / blood-pressure / weight
 * sibling tables, which keep working (and now mirror here) until the sunset
 * migration.
 */
@Injectable()
export class ObservationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── observations ─────────────────────────

  async list(profileId: string, query: ObservationsQuery) {
    const items = await this.prisma.observation.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        ...(query.concept ? { concept: query.concept } : {}),
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.from || query.to
          ? { measuredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
      },
      orderBy: { measuredAt: "desc" },
      take: 1000,
    });
    return items.map(observationDto);
  }

  async byId(profileId: string, id: string) {
    const row = await this.prisma.observation.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    return row ? observationDto(row) : null;
  }

  async create(profileId: string, input: ObservationInput, actor: Actor) {
    const stamp = stampProvenanceFor(actor);
    rejectClientInterpretation(input.interpretation, stamp.provenanceSource);
    const concept = requireConcept(input.concept);
    const value = canonicalize(concept, input);

    const created = await this.prisma.$transaction(async (tx) => {
      if (input.encounterId) await EncountersService.requireEncounter(tx, profileId, input.encounterId);
      if (input.deviceId) await this.requireOwnDevice(tx, profileId, input.deviceId);
      const timezone = await profileTimezone(tx, profileId);
      const row = await tx.observation.create({
        data: this.observationData(profileId, concept, input, value, timezone, stamp),
      });
      await this.afterCreate(tx, profileId, actor, row);

      // Mirrors the V1 BloodPressureReading.pulseBpm column: the cuff
      // reported two different things, so the record keeps two observations
      // rather than pretending a pulse is part of a blood pressure.
      if (input.concept === "blood_pressure" && input.pulseBpm !== undefined) {
        const heartRate = requireConcept("heart_rate");
        const pulse = canonicalize(heartRate, { valueNumeric: input.pulseBpm, valueNumeric2: undefined, enteredUnit: undefined });
        const pulseRow = await tx.observation.create({
          data: this.observationData(
            profileId,
            heartRate,
            { ...input, concept: "heart_rate", valueNumeric: input.pulseBpm, valueNumeric2: undefined, enteredUnit: undefined, enteredValueText: undefined, clientMutationId: undefined },
            pulse,
            timezone,
            stamp,
          ),
        });
        await this.afterCreate(tx, profileId, actor, pulseRow);
      }
      return row;
    });
    return (await this.byId(profileId, created.id))!;
  }

  /**
   * Device sync (docs_v2/05 §7). Deduped on `(concept, measuredAt, deviceId)`
   * both against what is already stored and within the batch itself, so a
   * meter handed over twice, or an upload retried on a flaky train, leaves
   * one diary rather than two.
   */
  async createBatch(profileId: string, input: ObservationBatchInput, actor: Actor) {
    const stamp = stampProvenanceFor(actor);
    const prepared = input.items.map((item) => {
      rejectClientInterpretation(item.interpretation, stamp.provenanceSource);
      const concept = requireConcept(item.concept);
      const deviceId = item.deviceId ?? input.deviceId ?? null;
      return { item, concept, deviceId, value: canonicalize(concept, item) };
    });

    return this.prisma.$transaction(async (tx) => {
      const deviceIds = [...new Set(prepared.map((p) => p.deviceId).filter((d): d is string => d !== null))];
      for (const deviceId of deviceIds) await this.requireOwnDevice(tx, profileId, deviceId);
      const timezone = await profileTimezone(tx, profileId);

      const existing = await tx.observation.findMany({
        where: {
          patientProfileId: profileId,
          deletedAt: null,
          concept: { in: [...new Set(prepared.map((p) => p.item.concept))] },
          measuredAt: { in: prepared.map((p) => p.item.measuredAt) },
        },
        select: { id: true, concept: true, measuredAt: true, deviceId: true },
      });
      const seen = new Map(existing.map((e) => [dedupeKey(e.concept, e.measuredAt, e.deviceId), e.id]));

      const created: Observation[] = [];
      const duplicates: Array<{ concept: string; measuredAt: string; existingId: string }> = [];
      for (const p of prepared) {
        const key = dedupeKey(p.item.concept, p.item.measuredAt, p.deviceId);
        const already = seen.get(key);
        if (already) {
          duplicates.push({ concept: p.item.concept, measuredAt: p.item.measuredAt.toISOString(), existingId: already });
          continue;
        }
        const row = await tx.observation.create({
          data: this.observationData(profileId, p.concept, { ...p.item, deviceId: p.deviceId ?? undefined }, p.value, timezone, stamp),
        });
        seen.set(key, row.id);
        created.push(row);
        await this.afterCreate(tx, profileId, actor, row);
      }

      for (const deviceId of deviceIds) {
        await tx.measurementDevice.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } });
      }
      await writeAudit(tx, {
        action: "observation.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "observation",
        entityId: created[0]?.id ?? profileId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { batch: true, submitted: input.items.length, created: created.length, duplicates: duplicates.length },
      });

      return {
        submitted: input.items.length,
        created: created.length,
        duplicates: duplicates.length,
        duplicateOf: duplicates,
        items: created.map(observationDto),
      };
    });
  }

  async softDelete(profileId: string, id: string, actor: Actor) {
    const row = await this.prisma.observation.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reading not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.observation.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "observation", id);
      await writeAudit(tx, {
        action: "observation.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "observation",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { concept: row.concept },
      });
    });
  }

  /**
   * One concept's trend over a 7d / 30d / 90d window, bucketed by day, week
   * or month (docs_v2/05 §7). Buckets are cut on `measuredAtLocal` — the
   * patient's own calendar day, never the viewer's (docs/16, hazard H-28):
   * a 11pm reading in Kolkata belongs to that Tuesday, whichever timezone
   * the doctor reading it happens to be in.
   *
   * Returns descriptive statistics only — count, average, min, max, a
   * running average and a morning/evening split. No band, no flag, no
   * verdict: this app describes what was measured and never interprets it
   * (hazard H-25).
   */
  async trend(profileId: string, conceptKey: string, query: ObservationTrendQuery) {
    const concept = requireConcept(conceptKey);
    const timezone = await profileTimezone(this.prisma, profileId);
    const to = new Date();
    const from = new Date(to.getTime() - TREND_WINDOW_DAYS[query.window] * 86_400_000);

    const rows = await this.prisma.observation.findMany({
      where: { patientProfileId: profileId, concept: concept.key as never, deletedAt: null, measuredAt: { gte: from, lte: to } },
      orderBy: { measuredAt: "asc" },
    });

    const buckets = new Map<string, Sample[]>();
    const all: Sample[] = [];
    for (const row of rows) {
      if (row.valueNumeric === null) continue;
      const local = row.measuredAtLocal ?? localIso(row.measuredAt, timezone);
      const sample: Sample = {
        value: Number(row.valueNumeric),
        value2: row.valueNumeric2 === null ? null : Number(row.valueNumeric2),
        // Local clock hour, so "morning" means the patient's morning.
        hour: Number(local.slice(11, 13)),
      };
      all.push(sample);
      const key = bucketKey(local, query.bucket);
      buckets.set(key, [...(buckets.get(key) ?? []), sample]);
    }

    let runningSum = 0;
    let runningCount = 0;
    const points = [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([bucket, samples]) => {
        runningSum += samples.reduce((sum, s) => sum + s.value, 0);
        runningCount += samples.length;
        return {
          bucket,
          ...describe(samples),
          /** Cumulative mean up to and including this bucket. */
          rollingAverage: round(runningSum / runningCount),
        };
      });

    return {
      concept: concept.key,
      label: concept.display,
      unit: concept.canonicalUnit,
      unitDisplay: concept.canonicalUnitDisplay,
      window: query.window,
      bucket: query.bucket,
      from: from.toISOString(),
      to: to.toISOString(),
      timezone,
      points,
      summary: describe(all),
    };
  }

  // ───────────────────────── measurement devices ─────────────────────────

  async listDevices(profileId: string) {
    const devices = await this.prisma.measurementDevice.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      include: { _count: { select: { observations: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: "desc" },
    });
    return devices.map(deviceDto);
  }

  async createDevice(profileId: string, input: MeasurementDeviceInput, actor: Actor) {
    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.measurementDevice.create({
        data: {
          patientProfileId: profileId,
          kind: input.kind,
          platform: input.platform,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          // Never the serial itself: enough to recognise the same meter
          // twice, useless to anyone who gets hold of the row.
          serialDigest: input.serialDigest ?? null,
          label: input.label ?? null,
          recordedByUserId: actor.userId,
        },
      });
      await writeAudit(tx, {
        action: "measurement_device.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "measurement_device",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: input.kind, platform: input.platform },
      });
      return created;
    });
    return deviceDto(device);
  }

  async updateDevice(profileId: string, id: string, input: UpdateMeasurementDeviceInput, actor: Actor) {
    await this.requireOwnDevice(this.prisma, profileId, id);
    const device = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.measurementDevice.update({
        where: { id },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.platform !== undefined ? { platform: input.platform } : {}),
          ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.serialDigest !== undefined ? { serialDigest: input.serialDigest } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await writeAudit(tx, {
        action: "measurement_device.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "measurement_device",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input) },
      });
      return updated;
    });
    return deviceDto(device);
  }

  /**
   * Soft-delete. The readings the device produced stay — they are the
   * patient's measurements, not the meter's, and losing a year of glucose
   * because a glucometer was thrown away would be the real data loss.
   */
  async deleteDevice(profileId: string, id: string, actor: Actor) {
    await this.requireOwnDevice(this.prisma, profileId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.measurementDevice.update({ where: { id }, data: { deletedAt: new Date(), status: "retired" } });
      await writeAudit(tx, {
        action: "measurement_device.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "measurement_device",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  // ───────────────────────── V1 lists served from here ─────────────────────────

  /**
   * The V1 `*-readings` lists, read from Observation so a reading entered on
   * the V2 measurements screens shows up on the V1 screens too (docs_v2/05
   * §7). Mirrored V1 rows and V2-born rows come back together, newest first,
   * in the V1 shapes — see legacy-views.ts for the id rule.
   */
  async listAsLegacy(profileId: string, kind: "glucose" | "blood_pressure" | "weight") {
    const concept = kind === "glucose" ? "blood_glucose" : kind === "blood_pressure" ? "blood_pressure" : "body_weight";
    const rows = await this.prisma.observation.findMany({
      where: { patientProfileId: profileId, deletedAt: null, concept: { in: kind === "blood_pressure" ? [concept, "heart_rate"] : [concept] } },
      orderBy: { measuredAt: "desc" },
      take: 2000,
    });
    if (kind === "glucose") return rows.map(toLegacyGlucose);
    if (kind === "weight") return rows.map(toLegacyWeight);
    const pulses = rows.filter((r) => r.concept === "heart_rate");
    return rows.filter((r) => r.concept === "blood_pressure").map((r) => toLegacyBloodPressure(r, pulses));
  }

  // ───────────────────────── V1 dual-write mirror ─────────────────────────

  /**
   * Creates the `Observation` twin of a V1 reading, inside the V1 write's own
   * transaction (task 3 / ADR-V2-011). Keyed on `(legacyEntityType, legacyId)`
   * so the backfill cron and the live dual-write can never both insert it.
   *
   * Deliberately silent on the timeline: the V1 write already emitted the
   * `measurement` event for this reading, and a second one would show the
   * same blood-sugar test twice.
   */
  async mirrorLegacyReading(
    tx: Tx,
    profileId: string,
    legacy: {
      /**
       * One V1 row can become two V2 rows — a blood pressure and the pulse
       * the same cuff reported — so the pulse gets its own key rather than
       * colliding on the unique `(legacyEntityType, legacyId)` pair.
       */
      entityType: "glucose_reading" | "blood_pressure_reading" | "blood_pressure_reading_pulse" | "weight_reading";
      id: string;
      measuredAt: Date;
      note?: string | null;
      context?: string | null;
      provenanceSource: string | null;
      verification: string | null;
      recordedVia: string | null;
      recordedByUserId: string | null;
    },
    values: { concept: string; valueNumeric: string; valueNumeric2?: string | null },
    timezone: string,
  ): Promise<void> {
    const concept = requireConcept(values.concept);
    await tx.observation.upsert({
      where: { legacyEntityType_legacyId: { legacyEntityType: legacy.entityType, legacyId: legacy.id } },
      create: {
        patientProfileId: profileId,
        concept: concept.key as never,
        conceptCode: concept.loincCode,
        conceptSystem: concept.loincCode ? LOINC_SYSTEM : null,
        valueNumeric: values.valueNumeric,
        valueNumeric2: values.valueNumeric2 ?? null,
        // V1 stored one unit per table by construction, and it is this
        // concept's canonical unit — nothing to convert.
        unit: concept.canonicalUnit ?? "",
        context: legacy.context ? (GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT[legacy.context as GlucoseReadingContext] ?? null) : null,
        measuredAt: legacy.measuredAt,
        measuredAtLocal: localIso(legacy.measuredAt, timezone),
        notes: legacy.note ?? null,
        legacyEntityType: legacy.entityType,
        legacyId: legacy.id,
        provenanceSource: legacy.provenanceSource as never,
        verification: legacy.verification as never,
        recordedVia: legacy.recordedVia,
        recordedByUserId: legacy.recordedByUserId,
      },
      update: {},
      select: { id: true },
    });
  }

  /** V1 soft-delete → the mirror is soft-deleted too, in the same transaction. */
  async softDeleteMirroredReading(tx: Tx, entityType: string, legacyId: string): Promise<void> {
    await tx.observation.updateMany({
      where: { legacyEntityType: entityType, legacyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** The observation-concept code table — static, PHI-free, safe to serve unauthenticated. */
  static conceptTerminology() {
    return {
      system: LOINC_SYSTEM,
      items: listObservationConcepts().map((c) => ({
        key: c.key,
        display: c.display,
        loincCode: c.loincCode,
        loincDisplay: c.loincDisplay,
        canonicalUnit: c.canonicalUnit,
        canonicalUnitDisplay: c.canonicalUnitDisplay,
        allowedEnteredUnits: c.canonicalUnit === null ? [] : listAllowedUnits(c.key),
        hasTwoValues: c.hasTwoValues,
        plausibility: c.plausibility,
        components: c.components,
      })),
    };
  }

  // ───────────────────────── internals ─────────────────────────

  private observationData(
    profileId: string,
    concept: ObservationConceptEntry,
    input: ObservationInput,
    value: CanonicalValue,
    timezone: string,
    stamp: ReturnType<typeof stampProvenanceFor>,
  ) {
    return {
      patientProfileId: profileId,
      concept: concept.key as never,
      conceptCode: concept.loincCode,
      conceptSystem: concept.loincCode ? LOINC_SYSTEM : null,
      valueNumeric: value.valueNumeric,
      valueNumeric2: value.valueNumeric2,
      valueText: input.valueText ?? null,
      unit: value.unit,
      enteredUnit: input.enteredUnit ?? null,
      enteredValueText: input.enteredValueText ?? null,
      context: input.context ?? null,
      bodySite: input.bodySite ?? null,
      method: input.method ?? null,
      measuredAt: input.measuredAt,
      // The patient's own clock, resolved once at write time so a later
      // timezone change cannot retroactively move a reading to another day.
      measuredAtLocal: localIso(input.measuredAt, timezone),
      interpretation: input.interpretation ?? null,
      notes: input.notes ?? null,
      deviceId: input.deviceId ?? null,
      sourceDeviceId: input.deviceId ?? null,
      clientMutationId: input.clientMutationId ?? null,
      encounterId: input.encounterId ?? null,
      ...stamp,
    };
  }

  private async afterCreate(tx: Tx, profileId: string, actor: Actor, row: Observation): Promise<void> {
    await writeAudit(tx, {
      action: "observation.created",
      actorUserId: actor.userId,
      actorType: actor.actorRole,
      entityType: "observation",
      entityId: row.id,
      patientProfileId: profileId,
      correlationId: actor.correlationId,
      // The concept is not PHI; the number itself never goes in context.
      context: { concept: row.concept },
    });
    await emitHealthEvent(tx, projectObservation(await eventCtx(tx, profileId, actor), row));
  }

  private async requireOwnDevice(tx: Tx | PrismaService, profileId: string, deviceId: string) {
    const device = await tx.measurementDevice.findFirst({
      where: { id: deviceId, patientProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!device) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Device not found", 404);
    return device;
  }
}

interface Sample {
  value: number;
  value2: number | null;
  hour: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Morning is before noon on the patient's own clock; evening is the rest of their day. */
function split(samples: Sample[]) {
  const morning = samples.filter((s) => s.hour < 12);
  const evening = samples.filter((s) => s.hour >= 12);
  const mean = (list: Sample[]) => (list.length === 0 ? null : round(list.reduce((sum, s) => sum + s.value, 0) / list.length));
  return {
    morning: { count: morning.length, average: mean(morning) },
    evening: { count: evening.length, average: mean(evening) },
  };
}

function describe(samples: Sample[]) {
  if (samples.length === 0) {
    return { count: 0, average: null, min: null, max: null, average2: null, min2: null, max2: null, ...split(samples) };
  }
  const values = samples.map((s) => s.value);
  const seconds = samples.map((s) => s.value2).filter((v): v is number => v !== null);
  return {
    count: samples.length,
    average: round(values.reduce((a, b) => a + b, 0) / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
    average2: seconds.length === 0 ? null : round(seconds.reduce((a, b) => a + b, 0) / seconds.length),
    min2: seconds.length === 0 ? null : Math.min(...seconds),
    max2: seconds.length === 0 ? null : Math.max(...seconds),
    ...split(samples),
  };
}

/**
 * The bucket a local ISO date-time falls in. Weeks start Monday (ISO-8601,
 * and the week Indian clinics book by); months are calendar months. All cut
 * on the local string, so no UTC boundary can move a reading a day.
 */
function bucketKey(localIsoString: string, bucket: "day" | "week" | "month"): string {
  const date = localIsoString.slice(0, 10);
  if (bucket === "day") return date;
  if (bucket === "month") return date.slice(0, 7);
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const weekday = (utc.getUTCDay() + 6) % 7; // Monday = 0
  utc.setUTCDate(utc.getUTCDate() - weekday);
  return utc.toISOString().slice(0, 10);
}
