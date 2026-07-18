import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, MEDICATION_STATUS_TRANSITIONS, type MedicationStatus } from "@medpass/domain";
import { changeMedicationStatusSchema, createMedicationSchema, updateMedicationSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { IdempotencyService } from "../../common/idempotency.service";
import { MedicationsService } from "./medications.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";

@Controller()
export class MedicationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly medications: MedicationsService,
    private readonly scheduling: SchedulingService,
    private readonly safety: SafetyEvaluationService,
  ) {}

  @Get("profiles/current/medications")
  async list(@Query("status") status: string | undefined, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "view_medications");
    if (actorRole === "caregiver") {
      await writeAudit(this.prisma, {
        action: "medication.list_viewed",
        actorUserId: req.auth!.userId,
        actorType: "caregiver",
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    }
    const items = await this.medications.list(profileId, status);
    return { items };
  }

  /** Sensitive write: requires Idempotency-Key (docs/14). */
  @Post("profiles/current/medications")
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: ApiRequest,
  ) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    const input = parseWith(createMedicationSchema, body);

    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "patient_medication",
      operation: "create",
      requestDigestSource: body,
      execute: () =>
        this.medications.create(profileId, input, {
          userId: req.auth!.userId,
          actorRole,
          correlationId: req.correlationId,
        }),
    });
    return result;
  }

  @Get("medications/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_medications");
    const medication = await this.medications.byId(profileId, id);
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    return medication;
  }

  /**
   * Sensitive write: accepts an Idempotency-Key so a lost response (e.g. a
   * flaky connection, or a client that falls back to the offline queue when
   * it can't tell whether this request landed) doesn't risk a spurious
   * row-version conflict or a double-applied edit on retry — the same
   * clientMutationId a queued offline edit replays through `POST /v1/sync`
   * (docs/15) shares this exact ledger entry.
   */
  @Patch("medications/:id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: ApiRequest,
  ) {
    const { profileId, actorRole } = await this.access.require(req, "edit_medications");
    const input = parseWith(updateMedicationSchema, body);

    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "patient_medication",
      operation: "update",
      requestDigestSource: body,
      execute: () =>
        this.medications.update(profileId, id, input, {
          userId: req.auth!.userId,
          actorRole,
          correlationId: req.correlationId,
        }),
    });
    return result;
  }

  /** Status transitions are validated; stop/pause reasons attributed (docs/09). */
  @Post("medications/:id/status")
  async changeStatus(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_medications");
    const input = parseWith(changeMedicationStatusSchema, body);

    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);

    const allowed = MEDICATION_STATUS_TRANSITIONS[medication.status as MedicationStatus] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ApiProblem(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot change a ${medication.status} medicine to ${input.status}`,
        400,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientMedication.updateMany({
        where: { id, rowVersion: input.rowVersion },
        data: {
          status: input.status,
          statusChangedAt: new Date(),
          statusReason: input.reason,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This medicine was changed elsewhere. Reload and retry.", 409);
      }
      await tx.medicationChange.create({
        data: {
          patientMedicationId: id,
          change: "status_changed",
          detail: { from: medication.status, to: input.status, reason: input.reason ?? null },
          actorUserId: req.auth!.userId,
        },
      });
      await writeAudit(tx, {
        action: "medication.status_changed",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { from: medication.status, to: input.status },
      });
      const fresh = await tx.patientMedication.findUniqueOrThrow({ where: { id } });
      return { id: fresh.id, status: fresh.status, rowVersion: fresh.rowVersion };
    }).then(async (result) => {
      // Restarting regenerates the window; anything else stops future doses
      // from appearing so a paused/stopped medicine doesn't keep nagging.
      if (input.status === "current") {
        await this.scheduling.regenerateForMedication(id);
        // Restarting a medicine re-runs safety review (docs/09).
        await this.safety.evaluate(profileId, "medication_restarted");
      } else {
        await this.scheduling.cancelFutureUpcomingDoses(id);
      }
      return result;
    });
  }

  @Get("medications/:id/history")
  async history(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_medications");
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId },
      select: { id: true },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    const items = await this.prisma.medicationChange.findMany({
      where: { patientMedicationId: id },
      orderBy: { occurredAt: "desc" },
    });
    return { items };
  }

  @Delete("medications/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_medications");
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.patientMedication.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.medicationChange.create({
        data: { patientMedicationId: id, change: "deleted", actorUserId: req.auth!.userId },
      });
      await writeAudit(tx, {
        action: "medication.deleted",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
    await this.scheduling.cancelFutureUpcomingDoses(id);
  }
}
