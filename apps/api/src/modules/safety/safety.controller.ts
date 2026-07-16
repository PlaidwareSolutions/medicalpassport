import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { recordFindingActionSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { SafetyEvaluationService } from "./safety-evaluation.service";

const ACTION_TO_STATUS = {
  acknowledged: "acknowledged",
  reviewed_with_professional: "reviewed_with_professional",
  resolved: "resolved",
  // note_added leaves status untouched — it's an annotation, not a state change.
} as const;

@Controller()
export class SafetyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
    private readonly safety: SafetyEvaluationService,
  ) {}

  /** Manual re-check (docs/14); most flows trigger evaluation automatically. */
  @Post("profiles/current/safety/evaluate")
  async evaluate(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "review_concerns");
    return this.safety.evaluate(profileId, "manual");
  }

  /** Screen 21: findings from the most recent evaluation only (docs/09). */
  @Get("profiles/current/safety/findings")
  async findings(@Query("status") status: string | undefined, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "review_concerns");
    const items = await this.safety.currentFindings(profileId, status);
    if (actorRole === "caregiver") {
      await writeAudit(this.prisma, {
        action: "finding.viewed",
        actorUserId: req.auth!.userId,
        actorType: "caregiver",
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    }
    return { items };
  }

  /**
   * Records a patient/caregiver action on a finding. Never deletes the
   * finding — acknowledging a high-severity concern keeps it visible as
   * acknowledged (docs/09), it doesn't hide it.
   */
  @Post("findings/:id/actions")
  async recordAction(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "review_concerns");
    const input = parseWith(recordFindingActionSchema, body);

    const finding = await this.prisma.safetyFinding.findFirst({ where: { id, patientProfileId: profileId } });
    if (!finding) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Finding not found", 404);

    const nextStatus = ACTION_TO_STATUS[input.action as keyof typeof ACTION_TO_STATUS];

    return this.prisma.$transaction(async (tx) => {
      await tx.safetyFindingAction.create({
        data: { findingId: id, action: input.action, note: input.note, actorUserId: req.auth!.userId },
      });
      if (nextStatus) {
        await tx.safetyFinding.update({
          where: { id },
          data: {
            status: nextStatus,
            ...(nextStatus === "resolved" ? { resolvedByUserId: req.auth!.userId, resolvedAt: new Date() } : {}),
          },
        });
      }
      await writeAudit(tx, {
        action: input.action === "acknowledged" ? "finding.acknowledged" : "finding.action_recorded",
        actorUserId: req.auth!.userId,
        actorType: actorRole,
        entityType: "safety_finding",
        entityId: id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { action: input.action, ruleVersion: finding.ruleVersion },
      });
      const fresh = await tx.safetyFinding.findUniqueOrThrow({ where: { id } });
      return { id: fresh.id, status: fresh.status };
    });
  }
}
