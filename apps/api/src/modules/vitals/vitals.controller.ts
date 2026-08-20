import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { bloodPressureReadingSchema, weightReadingSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";

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
  ) {}

  @Get("profiles/current/blood-pressure-readings")
  async listBloodPressureReadings(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const items = await this.prisma.bloodPressureReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { measuredAt: "desc" },
    });
    return { items };
  }

  @Post("profiles/current/blood-pressure-readings")
  async addBloodPressureReading(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(bloodPressureReadingSchema, body);

    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bloodPressureReading.create({
        data: { ...input, patientProfileId: profileId, recordedByUserId: req.auth!.userId },
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
    if (!reading) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reading not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.bloodPressureReading.update({ where: { id }, data: { deletedAt: new Date() } });
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
    const items = await this.prisma.weightReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { measuredAt: "desc" },
    });
    return { items };
  }

  @Post("profiles/current/weight-readings")
  async addWeightReading(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(weightReadingSchema, body);

    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.weightReading.create({
        data: { ...input, patientProfileId: profileId, recordedByUserId: req.auth!.userId },
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
    if (!reading) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reading not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.weightReading.update({ where: { id }, data: { deletedAt: new Date() } });
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
