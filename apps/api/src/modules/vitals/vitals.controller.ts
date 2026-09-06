import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { emitHealthEvent, projectReading, supersedeHealthEvents } from "@medpass/health-events";
import { bloodPressureReadingSchema, weightReadingSchema } from "@medpass/validation";
import { eventCtx, profileTimezone } from "../../common/health-events";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor } from "../../common/provenance";
import { stampProvenanceFor } from "../../common/provenance-actor";
import { ObservationsService } from "../observations/observations.service";

/**
 * Blood-pressure and body-weight diaries (screens 46/47) — the two vitals
 * siblings of the Blood Sugar Monitoring Diary, in their own controller for
 * the same reason GlucoseController got one. Identical access model
 * (view_profile/edit_profile, no dedicated scope for patient-self-reported
 * data) and identical point-in-time + soft-delete semantics: a typo is
 * delete + re-add, mirroring glucose readings.
 */
@Controller()
export class VitalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
    private readonly observations: ObservationsService,
  ) {}

  @Get("profiles/current/blood-pressure-readings")
  async listBloodPressureReadings(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    // Served from Observation (docs_v2/05 §7), so readings entered on the
    // V2 measurements screens appear here too. V1 rows keep their ids.
    const items = await this.observations.listAsLegacy(profileId, "blood_pressure");
    return { items };
  }

  @Post("profiles/current/blood-pressure-readings")
  async addBloodPressureReading(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(bloodPressureReadingSchema, body);

    const actor = { userId: req.auth!.userId, actorRole, recordedVia: recordedViaFor(req) };
    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bloodPressureReading.create({
        data: { ...input, patientProfileId: profileId, ...stampProvenanceFor(actor) },
      });
      await writeAudit(tx, {
        action: "blood_pressure_reading.created",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "blood_pressure_reading",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
      // Dual-write (ADR-V2-011, task 3). The cuff reported two different
      // things, so the V2 model keeps two observations: the pressure and,
      // separately, the pulse — a pulse is not part of a blood pressure.
      // Neither mirror emits an event; the projection below is the one and
      // only timeline entry for this reading.
      const timezone = await profileTimezone(tx, profileId);
      await this.observations.mirrorLegacyReading(
        tx,
        profileId,
        { entityType: "blood_pressure_reading", ...created },
        { concept: "blood_pressure", valueNumeric: String(created.systolic), valueNumeric2: String(created.diastolic) },
        timezone,
      );
      if (created.pulseBpm != null) {
        await this.observations.mirrorLegacyReading(
          tx,
          profileId,
          { entityType: "blood_pressure_reading_pulse", ...created, note: null },
          { concept: "heart_rate", valueNumeric: String(created.pulseBpm) },
          timezone,
        );
      }
      await emitHealthEvent(
        tx,
        projectReading(await eventCtx(tx, profileId, actor), "blood_pressure", {
          ...created,
          summary: { systolic: created.systolic, diastolic: created.diastolic, pulse: created.pulseBpm, unit: "mmHg" },
        }),
      );
      return created;
    });
    return reading;
  }

  @Delete("blood-pressure-readings/:id")
  @HttpCode(204)
  async deleteBloodPressureReading(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const reading = await this.prisma.bloodPressureReading.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!reading) {
      // Not a V1 row: the list also serves V2-born observations under their
      // own ids, so deleting one from a V1 screen deletes the observation.
      await this.observations.softDelete(profileId, id, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bloodPressureReading.update({ where: { id }, data: { deletedAt: new Date() } });
      // Both V2 mirrors follow the V1 row's lifecycle exactly (task 3).
      await this.observations.softDeleteMirroredReading(tx, "blood_pressure_reading", id);
      await this.observations.softDeleteMirroredReading(tx, "blood_pressure_reading_pulse", id);
      await supersedeHealthEvents(tx, "blood_pressure_reading", id);
      await writeAudit(tx, {
        action: "blood_pressure_reading.deleted",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "blood_pressure_reading",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
  }

  @Get("profiles/current/weight-readings")
  async listWeightReadings(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    // Served from Observation (docs_v2/05 §7), so readings entered on the
    // V2 measurements screens appear here too. V1 rows keep their ids.
    const items = await this.observations.listAsLegacy(profileId, "weight");
    return { items };
  }

  @Post("profiles/current/weight-readings")
  async addWeightReading(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(weightReadingSchema, body);

    const actor = { userId: req.auth!.userId, actorRole, recordedVia: recordedViaFor(req) };
    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.weightReading.create({
        data: { ...input, patientProfileId: profileId, ...stampProvenanceFor(actor) },
      });
      await writeAudit(tx, {
        action: "weight_reading.created",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "weight_reading",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
      // Dual-write (task 3); no second event, same as the other V1 diaries.
      await this.observations.mirrorLegacyReading(
        tx,
        profileId,
        { entityType: "weight_reading", ...created },
        { concept: "body_weight", valueNumeric: created.weightKg.toString() },
        await profileTimezone(tx, profileId),
      );
      await emitHealthEvent(
        tx,
        projectReading(await eventCtx(tx, profileId, actor), "body_weight", {
          ...created,
          summary: { value: created.weightKg.toString(), unit: "kg" },
        }),
      );
      return created;
    });
    return reading;
  }

  @Delete("weight-readings/:id")
  @HttpCode(204)
  async deleteWeightReading(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const reading = await this.prisma.weightReading.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!reading) {
      // Not a V1 row: the list also serves V2-born observations under their
      // own ids, so deleting one from a V1 screen deletes the observation.
      await this.observations.softDelete(profileId, id, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.weightReading.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.observations.softDeleteMirroredReading(tx, "weight_reading", id);
      await supersedeHealthEvents(tx, "weight_reading", id);
      await writeAudit(tx, {
        action: "weight_reading.deleted",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "weight_reading",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
  }
}
