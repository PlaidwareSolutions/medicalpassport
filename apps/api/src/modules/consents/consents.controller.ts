import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Param } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { grantConsentSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";

@Controller()
export class ConsentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

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
      // Cascade enforcement hooks land with their features (channels: Stage 4,
      // sharing: Stage 7). Caregiver-access consent is enforced via the
      // relationship tables today.
      return updated;
    });
  }
}
