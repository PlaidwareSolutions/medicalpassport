import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "../../common/errors";
import { newOpaqueToken, sha256Hex } from "../../common/crypto";
import { PrismaService } from "../../common/prisma.service";
import { ALL_SECTIONS, VisitSummaryService, type VisitSummarySections } from "./visit-summary.service";

const MAX_EXPIRY_HOURS = 30 * 24; // docs/14: expiry ≤ 30 days

export interface CreateShareInput {
  sections: Partial<VisitSummarySections>;
  expiresInHours: number;
  kind: "link" | "qr";
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSummary: VisitSummaryService,
  ) {}

  async create(profileId: string, actorUserId: string, input: CreateShareInput, correlationId?: string) {
    const expiresInHours = Math.min(input.expiresInHours, MAX_EXPIRY_HOURS);
    const sections = { ...ALL_SECTIONS, ...input.sections };
    const token = newOpaqueToken();

    const link = await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.sharePackage.create({
        data: { patientProfileId: profileId, sections: sections as object, createdByUserId: actorUserId },
      });
      const created = await tx.shareLink.create({
        data: {
          sharePackageId: pkg.id,
          tokenHash: sha256Hex(token),
          kind: input.kind,
          expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
        },
      });
      await writeAudit(tx, {
        action: "share.created",
        actorUserId,
        actorType: "patient",
        entityType: "share_link",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId,
        context: { kind: input.kind, sections },
      });
      return created;
    });

    return { id: link.id, token, expiresAt: link.expiresAt.toISOString() };
  }

  async list(profileId: string) {
    const links = await this.prisma.shareLink.findMany({
      where: { sharePackage: { patientProfileId: profileId } },
      include: { sharePackage: true, _count: { select: { accessEvents: true } } },
      orderBy: { createdAt: "desc" },
    });
    return links.map((l) => ({
      id: l.id,
      kind: l.kind,
      sections: l.sharePackage.sections,
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      accessCount: l._count.accessEvents,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async accessLog(profileId: string, shareLinkId: string) {
    const link = await this.prisma.shareLink.findFirst({
      where: { id: shareLinkId, sharePackage: { patientProfileId: profileId } },
    });
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Share not found", 404);
    const events = await this.prisma.shareAccessEvent.findMany({
      where: { shareLinkId },
      orderBy: { accessedAt: "desc" },
    });
    return events.map((e) => ({ result: e.result, accessedAt: e.accessedAt.toISOString() }));
  }

  async revoke(profileId: string, shareLinkId: string, actorUserId: string, correlationId?: string) {
    const link = await this.prisma.shareLink.findFirst({
      where: { id: shareLinkId, sharePackage: { patientProfileId: profileId } },
    });
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Share not found", 404);
    if (link.revokedAt) return { id: link.id, revokedAt: link.revokedAt.toISOString() };

    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({ where: { id: shareLinkId }, data: { revokedAt: new Date(), revokedByUserId: actorUserId } });
      await writeAudit(tx, {
        action: "share.revoked",
        actorUserId,
        actorType: "patient",
        entityType: "share_link",
        entityId: shareLinkId,
        patientProfileId: profileId,
        correlationId,
      });
    });
    return { id: link.id, revokedAt: new Date().toISOString() };
  }

  /** Incident-response revoke (docs/30 R9 "Share-link abuse") — unlike
   * revoke() above, not scoped to the owner's own profile: an admin acting
   * on a report may have no patient-side relationship to this share at all. */
  async revokeAsAdmin(shareLinkId: string, adminUserId: string, correlationId?: string, reason?: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { id: shareLinkId }, include: { sharePackage: true } });
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Share not found", 404);
    if (link.revokedAt) return { id: link.id, revokedAt: link.revokedAt.toISOString() };

    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({ where: { id: shareLinkId }, data: { revokedAt: new Date(), revokedByUserId: adminUserId } });
      await writeAudit(tx, {
        action: "admin.share_revoked",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "share_link",
        entityId: shareLinkId,
        patientProfileId: link.sharePackage.patientProfileId,
        correlationId,
        context: reason ? { reason } : undefined,
      });
    });
    return { id: link.id, revokedAt: new Date().toISOString() };
  }

  /**
   * Public access path (docs/14): no auth, token-hash lookup, expiry and
   * revocation enforced, every attempt recorded (not just successes) —
   * result never reveals *why* a token failed beyond "no longer available"
   * to the caller, but the patient-visible log records expired vs revoked.
   */
  async accessByToken(rawToken: string, ipDigest: string | undefined) {
    const tokenHash = sha256Hex(rawToken);
    const link = await this.prisma.shareLink.findUnique({ where: { tokenHash }, include: { sharePackage: true } });

    if (!link) {
      // No shareLinkId to attach the event to — an unknown token is not
      // recorded per-link (there is no link), only as a class of attempt
      // implicitly visible via absence. This matches "not_found" semantics
      // without inventing a row against a nonexistent resource.
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This link is no longer available", 404);
    }

    const now = new Date();
    const result = link.revokedAt ? "revoked" : link.expiresAt < now ? "expired" : "success";
    await this.prisma.shareAccessEvent.create({ data: { shareLinkId: link.id, result, ipDigest } });

    if (result !== "success") {
      await writeAudit(this.prisma, {
        action: "share.accessed",
        actorType: "share_visitor",
        entityType: "share_link",
        entityId: link.id,
        patientProfileId: link.sharePackage.patientProfileId,
        context: { result },
      });
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This link is no longer available", 404);
    }

    await writeAudit(this.prisma, {
      action: "share.accessed",
      actorType: "share_visitor",
      entityType: "share_link",
      entityId: link.id,
      patientProfileId: link.sharePackage.patientProfileId,
      context: { result },
    });

    // Read verbatim, deliberately NOT merged with ALL_SECTIONS: a share
    // created before a new section existed has no key for it, which reads as
    // falsy and omits it. That is the point — the patient who created that
    // link never consented to sharing data the section didn't cover yet.
    // Defaulting missing keys to true here would retroactively widen every
    // live link the moment a section is added.
    const sections = link.sharePackage.sections as unknown as VisitSummarySections;
    return this.visitSummary.build(link.sharePackage.patientProfileId, sections);
  }
}
