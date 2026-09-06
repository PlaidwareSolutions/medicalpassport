import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, SHARE_EXPIRY_PRESET_MINUTES, SHARE_MAX_EXPIRY_MINUTES } from "@medpass/domain";
import { emitHealthEvent, projectShare } from "@medpass/health-events";
import type { CreateShareInput } from "@medpass/validation";
import type { ShareAccessResult, ShareLink, SharePackage } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { profileTimezone } from "../../common/health-events";
import { hashShareToken, legacyShareTokenHash, newOpaqueToken } from "../../common/crypto";
import { PrismaService } from "../../common/prisma.service";
import { getObjectStorage } from "../../common/storage";
import { DoctorSnapshotService } from "./doctor-snapshot.service";
import { resolveShareSections, VisitSummaryService, type VisitSummarySections } from "./visit-summary.service";

const NO_LONGER_AVAILABLE = "This link is no longer available";

/** What a public access read — recorded on ShareAccessEvent.resource (docs_v2/05 §9). */
export type ShareResource = "summary" | "snapshot" | "document_page";

type ResolvedLink = ShareLink & { sharePackage: SharePackage };

/**
 * HOW LONG, resolved (docs_v2/04 §11): an explicit `expiresAt` wins, then a
 * preset, then the V1 `expiresInHours`; every path is capped at 30 days.
 */
export function resolveExpiry(input: Pick<CreateShareInput, "expiresAt" | "expiresIn" | "expiresInHours">, now = Date.now()): Date {
  const cap = now + SHARE_MAX_EXPIRY_MINUTES * 60_000;
  if (input.expiresAt) return new Date(Math.min(input.expiresAt.getTime(), cap));
  const minutes = input.expiresIn ? SHARE_EXPIRY_PRESET_MINUTES[input.expiresIn] : input.expiresInHours * 60;
  return new Date(Math.min(now + minutes * 60_000, cap));
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSummary: VisitSummaryService,
    private readonly doctorSnapshot: DoctorSnapshotService,
  ) {}

  async create(profileId: string, actorUserId: string, input: CreateShareInput, correlationId?: string) {
    const sections = resolveShareSections(input.sections);
    const expiresAt = resolveExpiry(input);
    const token = newOpaqueToken();

    const link = await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.sharePackage.create({
        data: { patientProfileId: profileId, sections: sections as object, createdByUserId: actorUserId },
      });
      const created = await tx.shareLink.create({
        data: {
          sharePackageId: pkg.id,
          // Peppered when SHARE_TOKEN_PEPPER is set (V2 Phase 7); the bare V1 hash otherwise.
          tokenHash: hashShareToken(token),
          kind: input.kind,
          audience: input.audience,
          expiresAt,
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
        context: { kind: input.kind, audience: input.audience, sections },
      });
      await emitHealthEvent(
        tx,
        projectShare(
          { patientProfileId: profileId, timezone: await profileTimezone(tx, profileId), actorUserId, actorType: "patient" },
          { id: created.id, createdAt: created.createdAt, sections, expiresAt: created.expiresAt, recordedByUserId: actorUserId },
        ),
      );
      return created;
    });

    return { id: link.id, token, audience: link.audience, sections, expiresAt: link.expiresAt.toISOString() };
  }

  async list(profileId: string) {
    const links = await this.prisma.shareLink.findMany({
      // Provider QR onboarding tokens (modules/providers) live in these
      // tables too but are not shares the patient manages here.
      where: { sharePackage: { patientProfileId: profileId }, NOT: { audience: "provider_onboarding" } },
      include: { sharePackage: true, _count: { select: { accessEvents: true } } },
      orderBy: { createdAt: "desc" },
    });
    return links.map((l) => ({
      id: l.id,
      kind: l.kind,
      audience: l.audience ?? "unspecified",
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
    return events.map((e) => ({
      result: e.result,
      // Rows from before the column existed were all summary reads.
      resource: (e.resource ?? "summary") as ShareResource,
      documentId: e.documentId,
      pageNumber: e.pageNumber,
      accessedAt: e.accessedAt.toISOString(),
    }));
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
    const link = await this.openLink(rawToken, ipDigest, "summary");
    return this.visitSummary.build(link.sharePackage.patientProfileId, this.sectionsOf(link));
  }

  /** `GET public/shares/:token/snapshot` (docs_v2/05 §9): the Doctor Snapshot, scoped by the same frozen sections. */
  async snapshotByToken(rawToken: string, ipDigest: string | undefined) {
    const link = await this.openLink(rawToken, ipDigest, "snapshot");
    return this.doctorSnapshot.build(link.sharePackage.patientProfileId, this.sectionsOf(link));
  }

  /**
   * One page of one shared document (docs_v2/05 §9): a short-lived signed
   * URL the controller redirects to. Refused — as an indistinguishable 404,
   * logged on the link as `not_found` — unless the share chose `documents`,
   * the document belongs to the shared profile, is live, and the page's
   * object is verified. The presigned URL is minted per request and never
   * stored, so it cannot outlive the read that produced it.
   */
  async documentPageByToken(rawToken: string, documentId: string, pageNumber: number, ipDigest: string | undefined) {
    const link = await this.openLink(rawToken, ipDigest, "document_page", { record: false });
    const profileId = link.sharePackage.patientProfileId;
    const sections = this.sectionsOf(link);

    const page = sections.documents
      ? await this.prisma.documentPage.findFirst({
          where: {
            pageNumber,
            document: { id: documentId, patientProfileId: profileId, deletedAt: null, status: { notIn: ["pending_upload", "deleted"] } },
            storedObject: { status: "verified" },
          },
          include: { storedObject: { select: { objectKey: true } } },
        })
      : null;

    await this.recordAccess(link, page ? "success" : "not_found", ipDigest, "document_page", { documentId, pageNumber });
    if (!page) throw new ApiProblem(ERROR_CODES.NOT_FOUND, NO_LONGER_AVAILABLE, 404);

    const presigned = await getObjectStorage().presignDownload({ bucket: "patient-docs", objectKey: page.storedObject.objectKey });
    return { url: presigned.url, expiresAt: presigned.expiresAt };
  }

  /**
   * Token → live link, or a 404 that never says why. Tries the peppered hash
   * first and the V1 bare hash second, so links minted before
   * SHARE_TOKEN_PEPPER was set keep working until they expire; a hit on the
   * legacy hash is never rewritten (the raw token is not ours to keep).
   */
  private async openLink(
    rawToken: string,
    ipDigest: string | undefined,
    resource: ShareResource,
    options: { record?: boolean } = {},
  ): Promise<ResolvedLink> {
    let link = await this.prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(rawToken) }, include: { sharePackage: true } });
    if (!link) {
      const legacyHash = legacyShareTokenHash(rawToken);
      if (legacyHash) {
        link = await this.prisma.shareLink.findUnique({ where: { tokenHash: legacyHash }, include: { sharePackage: true } });
      }
    }
    if (!link) {
      // No shareLinkId to attach the event to — an unknown token is not
      // recorded per-link (there is no link), only as a class of attempt
      // implicitly visible via absence. This matches "not_found" semantics
      // without inventing a row against a nonexistent resource.
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, NO_LONGER_AVAILABLE, 404);
    }

    const now = new Date();
    const result: ShareAccessResult = link.revokedAt ? "revoked" : link.expiresAt < now ? "expired" : "success";
    if (result !== "success" || options.record !== false) {
      await this.recordAccess(link, result, ipDigest, resource);
    }
    if (result !== "success") throw new ApiProblem(ERROR_CODES.NOT_FOUND, NO_LONGER_AVAILABLE, 404);
    return link;
  }

  private async recordAccess(
    link: ResolvedLink,
    result: ShareAccessResult,
    ipDigest: string | undefined,
    resource: ShareResource,
    detail: { documentId?: string; pageNumber?: number } = {},
  ): Promise<void> {
    await this.prisma.shareAccessEvent.create({
      data: {
        shareLinkId: link.id,
        result,
        ipDigest,
        resource,
        documentId: detail.documentId ?? null,
        pageNumber: detail.pageNumber ?? null,
      },
    });
    await writeAudit(this.prisma, {
      action: "share.accessed",
      actorType: "share_visitor",
      entityType: "share_link",
      entityId: link.id,
      patientProfileId: link.sharePackage.patientProfileId,
      // Which page of which document is not PHI (both are opaque ids), and
      // it is exactly what an incident review of a leaked link needs.
      context: { result, resource, ...(detail.pageNumber ? { pageNumber: detail.pageNumber } : {}) },
    });
  }

  /**
   * Read verbatim, deliberately NOT merged with ALL_SECTIONS: a share
   * created before a new section existed has no key for it, which reads as
   * falsy and omits it. That is the point — the patient who created that
   * link never consented to sharing data the section didn't cover yet.
   * Defaulting missing keys to true here would retroactively widen every
   * live link the moment a section is added.
   */
  private sectionsOf(link: ResolvedLink): VisitSummarySections {
    return link.sharePackage.sections as unknown as VisitSummarySections;
  }
}
