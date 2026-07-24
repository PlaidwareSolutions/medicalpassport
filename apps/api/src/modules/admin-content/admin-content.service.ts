import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { ProposeContentChangeInput, DecideContentChangeInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

const INGREDIENT_SELECT = { select: { id: true, name: true } } as const;

/**
 * Content review — kept as its own module rather than folded into
 * AdminCatalogChangesService (docs/06 lists Content as its own admin
 * section, separate from Catalog): approving content is a two-table
 * transition (version.reviewStatus + content.currentVersionId), not the
 * single-entity field dispatch AdminCatalogChangesService.applyChange()
 * does, and docs/34 ties content sign-off to a distinct, narrower
 * authority (a qualified clinical lead, OD-6) than general catalog
 * stewardship.
 *
 * Maker != checker mirrors AdminCatalogChangesService.decide() exactly,
 * except it only applies when `proposedByAdminUserId` is set — a
 * system-authored draft (the worker's openFDA fetch) has no human "maker"
 * to conflict with, so any reviewer with content_approve may decide it.
 */
@Injectable()
export class AdminContentService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.clinicalContent.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        ingredient: INGREDIENT_SELECT,
        currentVersion: true,
        _count: { select: { versions: { where: { reviewStatus: "draft" } } } },
      },
    });
  }

  async detail(id: string) {
    const content = await this.prisma.clinicalContent.findUnique({
      where: { id },
      include: {
        ingredient: INGREDIENT_SELECT,
        currentVersion: true,
        versions: {
          orderBy: { createdAt: "desc" },
          include: {
            proposedByAdminUser: { select: { id: true, email: true } },
            decidedByAdminUser: { select: { id: true, email: true } },
          },
        },
      },
    });
    if (!content) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Content not found", 404);
    return content;
  }

  /** The reviewer queue — every version awaiting a decision, regardless of which ingredient. */
  async versionsQueue(status?: string) {
    return this.prisma.clinicalContentVersion.findMany({
      where: { reviewStatus: (status as never) ?? "draft" },
      orderBy: { createdAt: "asc" },
      include: { content: { include: { ingredient: INGREDIENT_SELECT } } },
    });
  }

  async propose(input: ProposeContentChangeInput, adminUserId: string, correlationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const content = await tx.clinicalContent.upsert({
        where: { kind_ingredientId: { kind: input.kind, ingredientId: input.ingredientId } },
        create: { kind: input.kind, ingredientId: input.ingredientId },
        update: {},
      });
      const version = await tx.clinicalContentVersion.create({
        data: {
          contentId: content.id,
          body: input.body,
          sourceKind: "manual",
          sourceCitation: `Manually authored by admin ${adminUserId}`,
          sourceUrl: input.sourceUrl,
          proposedByAdminUserId: adminUserId,
        },
      });
      await writeAudit(tx, {
        action: "admin.content_change_proposed",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "clinical_content_version",
        entityId: version.id,
        correlationId,
        context: { ingredientId: input.ingredientId, kind: input.kind },
      });
      return version;
    });
  }

  async decide(versionId: string, input: DecideContentChangeInput, adminUserId: string, correlationId?: string) {
    const version = await this.prisma.clinicalContentVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Content version not found", 404);
    if (version.reviewStatus !== "draft") {
      throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This content has already been decided", 409);
    }

    if (input.decision === "reject") {
      return this.prisma.$transaction(async (tx) => {
        const result = await tx.clinicalContentVersion.updateMany({
          where: { id: versionId, reviewStatus: "draft" },
          data: { reviewStatus: "rejected", decidedByAdminUserId: adminUserId, decidedAt: new Date(), rejectionReason: input.rejectionReason },
        });
        if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This content has already been decided", 409);
        await writeAudit(tx, {
          action: "admin.content_change_rejected",
          actorUserId: adminUserId,
          actorType: "admin",
          entityType: "clinical_content_version",
          entityId: versionId,
          correlationId,
          context: { reason: input.rejectionReason },
        });
        return tx.clinicalContentVersion.findUniqueOrThrow({ where: { id: versionId } });
      });
    }

    // A system-authored draft (proposedByAdminUserId null) has no human
    // maker to conflict with — any reviewer may decide it. Only a manually
    // authored draft is subject to maker != checker.
    let isSoloApproval = false;
    if (version.proposedByAdminUserId) {
      const activeAdminCount = await this.prisma.adminUser.count({ where: { status: "active" } });
      const isSelfApproval = version.proposedByAdminUserId === adminUserId;
      if (activeAdminCount > 1 && isSelfApproval) {
        throw new ApiProblem(ERROR_CODES.MAKER_CHECKER_CONFLICT, "A different admin must approve this content", 403);
      }
      isSoloApproval = activeAdminCount <= 1 && isSelfApproval;
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.clinicalContentVersion.updateMany({
        where: { id: versionId, reviewStatus: "draft" },
        data: { reviewStatus: "approved", decidedByAdminUserId: adminUserId, decidedAt: new Date(), isSoloApproval },
      });
      if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This content has already been decided", 409);
      await tx.clinicalContent.update({ where: { id: version.contentId }, data: { currentVersionId: versionId } });

      await writeAudit(tx, {
        action: "admin.content_change_approved",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "clinical_content_version",
        entityId: versionId,
        correlationId,
        context: { isSoloApproval },
      });
      return tx.clinicalContentVersion.findUniqueOrThrow({ where: { id: versionId } });
    });
  }
}
