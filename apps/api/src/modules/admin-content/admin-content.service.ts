import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type {
  ProposeContentChangeInput,
  DecideContentChangeInput,
  ProposeContentTranslationInput,
  DecideContentTranslationInput,
} from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

const INGREDIENT_SELECT = { select: { id: true, name: true } } as const;
const PRODUCT_SELECT = { select: { id: true, genericName: true, brand: { select: { name: true } } } } as const;

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
        product: PRODUCT_SELECT,
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
        product: PRODUCT_SELECT,
        currentVersion: true,
        versions: {
          orderBy: { createdAt: "desc" },
          include: {
            proposedByAdminUser: { select: { id: true, email: true } },
            decidedByAdminUser: { select: { id: true, email: true } },
            translations: {
              orderBy: { createdAt: "desc" },
              include: {
                translatedByAdminUser: { select: { id: true, email: true } },
                decidedByAdminUser: { select: { id: true, email: true } },
              },
            },
          },
        },
      },
    });
    if (!content) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Content not found", 404);
    return content;
  }

  /** The reviewer queue — every version awaiting a decision, regardless of which ingredient/product. */
  async versionsQueue(status?: string) {
    return this.prisma.clinicalContentVersion.findMany({
      where: { reviewStatus: (status as never) ?? "draft" },
      orderBy: { createdAt: "asc" },
      include: { content: { include: { ingredient: INGREDIENT_SELECT, product: PRODUCT_SELECT } } },
    });
  }

  async propose(input: ProposeContentChangeInput, adminUserId: string, correlationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const content = input.ingredientId
        ? await tx.clinicalContent.upsert({
            where: { kind_ingredientId: { kind: input.kind, ingredientId: input.ingredientId } },
            create: { kind: input.kind, ingredientId: input.ingredientId },
            update: {},
          })
        : await tx.clinicalContent.upsert({
            where: { kind_productId: { kind: input.kind, productId: input.productId! } },
            create: { kind: input.kind, productId: input.productId! },
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
        context: { ingredientId: input.ingredientId, productId: input.productId, kind: input.kind },
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

  /**
   * Translations can only be proposed against an already-approved source
   * version (schema.prisma comment: "no system-translated concept" — a
   * translator always proposes a specific locale's text for a specific,
   * already-vetted English body, never before it's reviewed).
   */
  async proposeTranslation(versionId: string, input: ProposeContentTranslationInput, adminUserId: string, correlationId?: string) {
    const version = await this.prisma.clinicalContentVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Content version not found", 404);
    if (version.reviewStatus !== "approved") {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Only an approved version can be translated", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const translation = await tx.clinicalContentTranslation.create({
        data: {
          versionId,
          locale: input.locale,
          body: input.body,
          translatedByAdminUserId: adminUserId,
        },
      });
      await writeAudit(tx, {
        action: "admin.content_translation_proposed",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "clinical_content_translation",
        entityId: translation.id,
        correlationId,
        context: { versionId, locale: input.locale },
      });
      return translation;
    });
  }

  /**
   * Maker != checker always applies here — unlike a content version, a
   * translation always has a real human translator (translatedByAdminUserId
   * is never null), so there is no "system-authored, no maker" exception.
   */
  async decideTranslation(translationId: string, input: DecideContentTranslationInput, adminUserId: string, correlationId?: string) {
    const translation = await this.prisma.clinicalContentTranslation.findUnique({ where: { id: translationId } });
    if (!translation) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Translation not found", 404);
    if (translation.reviewStatus !== "draft") {
      throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This translation has already been decided", 409);
    }

    if (input.decision === "reject") {
      return this.prisma.$transaction(async (tx) => {
        const result = await tx.clinicalContentTranslation.updateMany({
          where: { id: translationId, reviewStatus: "draft" },
          data: { reviewStatus: "rejected", decidedByAdminUserId: adminUserId, decidedAt: new Date(), rejectionReason: input.rejectionReason },
        });
        if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This translation has already been decided", 409);
        await writeAudit(tx, {
          action: "admin.content_translation_rejected",
          actorUserId: adminUserId,
          actorType: "admin",
          entityType: "clinical_content_translation",
          entityId: translationId,
          correlationId,
          context: { reason: input.rejectionReason },
        });
        return tx.clinicalContentTranslation.findUniqueOrThrow({ where: { id: translationId } });
      });
    }

    const activeAdminCount = await this.prisma.adminUser.count({ where: { status: "active" } });
    const isSelfApproval = translation.translatedByAdminUserId === adminUserId;
    if (activeAdminCount > 1 && isSelfApproval) {
      throw new ApiProblem(ERROR_CODES.MAKER_CHECKER_CONFLICT, "A different admin must approve this translation", 403);
    }
    const isSoloApproval = activeAdminCount <= 1 && isSelfApproval;

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.clinicalContentTranslation.updateMany({
        where: { id: translationId, reviewStatus: "draft" },
        data: { reviewStatus: "approved", decidedByAdminUserId: adminUserId, decidedAt: new Date(), isSoloApproval },
      });
      if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This translation has already been decided", 409);
      await writeAudit(tx, {
        action: "admin.content_translation_approved",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "clinical_content_translation",
        entityId: translationId,
        correlationId,
        context: { isSoloApproval },
      });
      return tx.clinicalContentTranslation.findUniqueOrThrow({ where: { id: translationId } });
    });
  }
}
