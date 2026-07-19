import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Param } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type ConsentType } from "@medpass/domain";
import { grantConsentSchema } from "@medpass/validation";
import type { Prisma } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { decryptField, encryptField, phoneDigest } from "../../common/crypto";

@Controller()
export class ConsentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

  /**
   * Consent cascade (docs/18): granting/revoking `sms_reminders` activates
   * or revokes the matching SMS `NotificationChannel` — only the patient
   * (never a caregiver; `manage_consents` grants no caregiver scope, docs/18)
   * can reach this, so `req.auth!.userId`'s own on-file phone is always the
   * right number, the same one already verified at OTP sign-in.
   */
  private async cascadeConsent(tx: Prisma.TransactionClient, userId: string, type: ConsentType, status: "active" | "revoked") {
    if (type !== "sms_reminders") return;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { phoneCiphertext: true } });
    const phoneE164 = decryptField(user.phoneCiphertext);
    const endpointDigest = phoneDigest(phoneE164);
    await tx.notificationChannel.upsert({
      where: { endpointDigest },
      create: { userId, channel: "sms", addressCiphertext: encryptField(phoneE164), endpointDigest, status },
      update: { status },
    });
  }

  @Get("profiles/current/consents")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_consents");
    const items = await this.prisma.consent.findMany({
      where: { patientProfileId: profileId },
      include: { events: { orderBy: { occurredAt: "desc" }, take: 5 } },
      orderBy: { grantedAt: "desc" },
    });
    return { items };
  }

  @Post("profiles/current/consents")
  async grant(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_consents");
    const input = parseWith(grantConsentSchema, body);
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consent.create({
        data: {
          patientProfileId: profileId,
          type: input.type,
          purpose: input.purpose,
          scope: input.scope as object | undefined,
          expiresAt: input.expiresAt,
        },
      });
      await tx.consentEvent.create({ data: { consentId: consent.id, event: "granted", actorUserId: req.auth!.userId } });
      await writeAudit(tx, {
        action: "consent.granted",
        actorUserId: req.auth!.userId,
        actorType: "patient",
        entityType: "consent",
        entityId: consent.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { type: input.type },
      });
      await this.cascadeConsent(tx, req.auth!.userId, input.type, "active");
      return consent;
    });
  }

  /** Revocation cascades to dependent features (docs/18). */
  @Post("consents/:id/revoke")
  async revoke(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_consents");
    const consent = await this.prisma.consent.findFirst({ where: { id, patientProfileId: profileId } });
    if (!consent) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Consent not found", 404);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.consent.update({
        where: { id: consent.id },
        data: { status: "revoked", revokedAt: new Date() },
      });
      await tx.consentEvent.create({ data: { consentId: consent.id, event: "revoked", actorUserId: req.auth!.userId } });
      await writeAudit(tx, {
        action: "consent.revoked",
        actorUserId: req.auth!.userId,
        actorType: "patient",
        entityType: "consent",
        entityId: consent.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { type: consent.type },
      });
      await this.cascadeConsent(tx, req.auth!.userId, consent.type, "revoked");
      // Sharing (Stage 7) and caregiver-access consent cascades: sharing has
      // no consent-gated dependency yet; caregiver access is enforced via
      // the relationship tables directly today.
      return updated;
    });
  }
}
