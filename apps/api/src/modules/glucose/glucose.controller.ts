import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { emitHealthEvent, projectCheckup, projectReading, supersedeHealthEvents } from "@medpass/health-events";
import { checkupRecordSchema, glucoseReadingSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor } from "../../common/provenance";
import { stampProvenanceFor } from "../../common/provenance-actor";

/**
 * Blood Sugar Monitoring Diary (docs/07 screen 42) — a dedicated controller
 * rather than more endpoints bolted onto ProfilesController, which is
 * already the largest controller in the API. Same view_profile/edit_profile
 * scopes as allergies/conditions (no dedicated scope: simple patient-
 * self-reported data has never gotten its own narrower scope in this app).
 * Unlike allergies/conditions (ongoing facts, create+list only), a reading
 * or check-up is a point-in-time event — closer to a dose event — so these
 * also get a real soft-delete, mirroring medications.controller.ts's.
 */
@Controller()
export class GlucoseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

  @Get("profiles/current/glucose-readings")
  async listGlucoseReadings(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const items = await this.prisma.glucoseReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { measuredAt: "desc" },
    });
    return { items };
  }

  @Post("profiles/current/glucose-readings")
  async addGlucoseReading(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(glucoseReadingSchema, body);

    const actor = { userId: req.auth!.userId, actorRole, recordedVia: recordedViaFor(req) };
    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.glucoseReading.create({
        data: { ...input, patientProfileId: profileId, ...stampProvenanceFor(actor) },
      });
      await writeAudit(tx, {
        action: "glucose_reading.created",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "glucose_reading",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { measuredContext: input.context },
      });
      await emitHealthEvent(
        tx,
        projectReading(await eventCtx(tx, profileId, actor), "blood_glucose", {
          ...created,
          summary: { value: created.valueMgDl, unit: "mg/dL", context: created.context },
        }),
      );
      return created;
    });
    return reading;
  }

  @Delete("glucose-readings/:id")
  @HttpCode(204)
  async deleteGlucoseReading(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const reading = await this.prisma.glucoseReading.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!reading) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reading not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.glucoseReading.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "glucose_reading", id);
      await writeAudit(tx, {
        action: "glucose_reading.deleted",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "glucose_reading",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
  }

  @Get("profiles/current/checkup-records")
  async listCheckupRecords(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const items = await this.prisma.checkupRecord.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { checkupDate: "desc" },
    });
    return { items };
  }

  @Post("profiles/current/checkup-records")
  async addCheckupRecord(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(checkupRecordSchema, body);

    const actor = { userId: req.auth!.userId, actorRole, recordedVia: recordedViaFor(req) };
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.checkupRecord.create({
        data: { ...input, patientProfileId: profileId, ...stampProvenanceFor(actor) },
      });
      await writeAudit(tx, {
        action: "checkup_record.created",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "checkup_record",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
      // Only the metrics the doctor actually measured that visit — never a
      // fabricated value (docs/07 screen 42) — and only their names, so the
      // timeline card can say "BP, weight, HbA1c" without copying the numbers.
      const metrics: Record<string, boolean> = {};
      for (const key of [
        "fastingGlucoseMgDl",
        "postPrandialGlucoseMgDl",
        "hba1cPercent",
        "bloodPressureSystolic",
        "bloodPressureDiastolic",
        "weightKg",
        "waistCircumferenceCm",
        "cholesterolMgDl",
      ] as const) {
        if (created[key] != null) metrics[key] = true;
      }
      await emitHealthEvent(tx, projectCheckup(await eventCtx(tx, profileId, actor), { ...created, metrics }));
      return created;
    });
    return record;
  }

  @Delete("checkup-records/:id")
  @HttpCode(204)
  async deleteCheckupRecord(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const record = await this.prisma.checkupRecord.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!record) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Check-up record not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.checkupRecord.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "checkup_record", id);
      await writeAudit(tx, {
        action: "checkup_record.deleted",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "checkup_record",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
  }
}
