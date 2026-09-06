import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { BreakGlassGrant } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import type { BreakGlassRequestInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { decryptField } from "../../common/crypto";
import { PrismaService } from "../../common/prisma.service";
import { verifyTotpCode } from "../../common/totp";
import { NotificationsService } from "../notifications/notifications.service";

export function presentGrant(g: BreakGlassGrant, now = new Date()) {
  return {
    id: g.id,
    adminUserId: g.adminUserId,
    /** Opaque — never resolved to a person on any admin page. */
    patientProfileId: g.patientProfileId,
    reason: g.reason,
    supportCaseId: g.supportCaseId,
    grantedAt: g.grantedAt.toISOString(),
    expiresAt: g.expiresAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
    patientNotifiedAt: g.patientNotifiedAt?.toISOString() ?? null,
    reviewedAt: g.reviewedAt?.toISOString() ?? null,
    active: g.revokedAt === null && g.expiresAt > now,
  };
}

/**
 * Break-glass (docs_v2/10 H-49, docs_v2/11 §7, docs_v2/14 §3): the only
 * path by which admin personnel could ever reach clinical data, and in
 * this ticket a grant only — no admin clinical read endpoint exists. A
 * grant requires a written reason, a fresh TOTP (the admin step-up), is
 * time-boxed to at most 60 minutes, lands on the audit chain against the
 * patient profile, and queues the patient-facing "an administrator viewed
 * your record" notice inside the same transaction. `assertActive` is the
 * single check any future privileged read must call.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async grant(adminUserId: string, input: BreakGlassRequestInput, correlationId?: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId }, select: { mfaSecretCiphertext: true } });
    if (!admin.mfaSecretCiphertext || !verifyTotpCode(decryptField(admin.mfaSecretCiphertext), input.totpCode)) {
      throw new ApiProblem(ERROR_CODES.MFA_INVALID, "Enter your current authenticator code to continue", 403);
    }
    const profile = await this.prisma.patientProfile.findFirst({ where: { id: input.profileId, deletedAt: null }, select: { id: true } });
    if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);
    if (input.supportCaseId) {
      const supportCase = await this.prisma.supportCase.findUnique({ where: { id: input.supportCaseId }, select: { patientProfileId: true } });
      if (!supportCase) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
      if (supportCase.patientProfileId && supportCase.patientProfileId !== input.profileId) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "That support case is about a different profile", 400);
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.minutes * 60_000);
    const grant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.breakGlassGrant.create({
        data: { adminUserId, patientProfileId: input.profileId, reason: input.reason, supportCaseId: input.supportCaseId ?? null, grantedAt: now, expiresAt },
      });
      // H-49: the patient is always told. Queued here, delivered by the dispatch cron.
      await this.notifications.queueSystemNotification(tx, input.profileId, `break_glass:${created.id}`);
      const notified = await tx.breakGlassGrant.update({ where: { id: created.id }, data: { patientNotifiedAt: now } });
      await writeAudit(tx, {
        action: "admin.break_glass_granted",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "break_glass_grant",
        entityId: created.id,
        patientProfileId: input.profileId,
        correlationId,
        // The reason is the justification the weekly review reads; it is written by the admin and is not patient data.
        context: { reason: input.reason, minutes: input.minutes, expiresAt: expiresAt.toISOString(), supportCaseId: input.supportCaseId ?? null },
      });
      return notified;
    });
    return presentGrant(grant, now);
  }

  /** The one check a privileged read must pass: an unexpired, unrevoked grant for exactly this admin and profile. */
  async assertActive(adminUserId: string, patientProfileId: string, now = new Date()): Promise<BreakGlassGrant> {
    const grant = await this.prisma.breakGlassGrant.findFirst({
      where: { adminUserId, patientProfileId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: "desc" },
    });
    if (!grant) throw new ApiProblem(ERROR_CODES.FORBIDDEN, "No active break-glass grant for this record", 403);
    return grant;
  }
}
