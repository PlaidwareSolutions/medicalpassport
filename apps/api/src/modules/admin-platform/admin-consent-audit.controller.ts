import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { consentAuditQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/**
 * Consent audit (docs_v2/14 §3, audit_search): the `Consent` + `ConsentEvent`
 * and `AbdmConsentArtefact` timelines for one opaque profile id. Types,
 * purposes, statuses and instants only — `Consent.scope`, `ConsentEvent.context`
 * and the ABDM artefact JSON are never returned, and the profile is not
 * resolved to a person. Every lookup is audited against the profile so it
 * appears in the patient's own access history.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/consent-audit")
export class AdminConsentAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async timeline(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "search_audit");
    const { profileId } = parseWith(consentAuditQuerySchema, query);
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: profileId }, select: { id: true, deletedAt: true } });
    if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);

    const [consents, abhaLinks] = await Promise.all([
      this.prisma.consent.findMany({
        where: { patientProfileId: profileId },
        include: { events: { orderBy: { occurredAt: "asc" } } },
        orderBy: { grantedAt: "asc" },
      }),
      this.prisma.abhaLink.findMany({
        where: { patientProfileId: profileId },
        include: { consentArtefacts: { orderBy: { createdAt: "asc" } } },
        orderBy: { linkedAt: "asc" },
      }),
    ]);

    const timeline: Array<{ at: string; source: "consent" | "abdm"; id: string; event: string; type: string; actorType: "patient" | "system" | "unknown" }> = [];
    for (const c of consents) {
      for (const e of c.events) {
        timeline.push({ at: e.occurredAt.toISOString(), source: "consent", id: c.id, event: e.event, type: c.type, actorType: e.actorUserId ? "patient" : "system" });
      }
    }
    for (const link of abhaLinks) {
      for (const a of link.consentArtefacts) {
        timeline.push({ at: a.createdAt.toISOString(), source: "abdm", id: a.id, event: "requested", type: a.purposeCode, actorType: "unknown" });
        if (a.grantedAt) timeline.push({ at: a.grantedAt.toISOString(), source: "abdm", id: a.id, event: "granted", type: a.purposeCode, actorType: "unknown" });
        if (a.revokedAt) timeline.push({ at: a.revokedAt.toISOString(), source: "abdm", id: a.id, event: "revoked", type: a.purposeCode, actorType: "unknown" });
      }
    }
    timeline.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

    await writeAudit(this.prisma, {
      action: "admin.consent_audit_viewed",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      patientProfileId: profileId,
      correlationId: req.correlationId,
      context: { consents: consents.length, abdmArtefacts: abhaLinks.reduce((n, l) => n + l.consentArtefacts.length, 0) },
    });

    return {
      profileId,
      profileDeleted: profile.deletedAt !== null,
      consents: consents.map((c) => ({
        id: c.id,
        type: c.type,
        purpose: c.purpose,
        purposeVersion: c.purposeVersion,
        noticeVersion: c.noticeVersion,
        collectedVia: c.collectedVia,
        status: c.status,
        grantedAt: c.grantedAt.toISOString(),
        expiresAt: c.expiresAt?.toISOString() ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        events: c.events.map((e) => ({ id: e.id, event: e.event, occurredAt: e.occurredAt.toISOString(), actorType: e.actorUserId ? "patient" : "system" })),
      })),
      abdmConsents: abhaLinks.flatMap((link) =>
        link.consentArtefacts.map((a) => ({
          id: a.id,
          abhaLinkId: link.id,
          abhaLinkStatus: link.status,
          purposeCode: a.purposeCode,
          hiTypes: a.hiTypes,
          status: a.status,
          dateRangeFrom: a.dateRangeFrom?.toISOString() ?? null,
          dateRangeTo: a.dateRangeTo?.toISOString() ?? null,
          dataEraseAt: a.dataEraseAt?.toISOString() ?? null,
          grantedAt: a.grantedAt?.toISOString() ?? null,
          revokedAt: a.revokedAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      ),
      timeline,
    };
  }
}
