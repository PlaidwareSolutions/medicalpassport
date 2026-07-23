import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { Prisma, PrismaClient } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import type { ProposeCatalogChangeInput, DecideCatalogChangeInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

type Tx = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class AdminCatalogChangesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { status?: string; entityType?: string; requestedByAdminUserId?: string }) {
    return this.prisma.catalogChangeRequest.findMany({
      where: {
        status: filters.status as never,
        entityType: filters.entityType as never,
        requestedByAdminUserId: filters.requestedByAdminUserId,
      },
      orderBy: { createdAt: "desc" },
      include: { requestedByAdminUser: { select: { id: true, email: true } }, decidedByAdminUser: { select: { id: true, email: true } } },
    });
  }

  async detail(id: string) {
    const change = await this.prisma.catalogChangeRequest.findUnique({
      where: { id },
      include: { requestedByAdminUser: { select: { id: true, email: true } }, decidedByAdminUser: { select: { id: true, email: true } } },
    });
    if (!change) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Change request not found", 404);
    return change;
  }

  async propose(input: ProposeCatalogChangeInput, adminUserId: string, correlationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.catalogChangeRequest.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          operation: input.operation,
          proposedData: input.proposedData,
          requestedByAdminUserId: adminUserId,
        },
      });
      await writeAudit(tx, {
        action: "admin.catalog_change_proposed",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "catalog_change_request",
        entityId: change.id,
        correlationId,
        context: { entityType: input.entityType, operation: input.operation },
      });
      return change;
    });
  }

  async decide(id: string, input: DecideCatalogChangeInput, adminUserId: string, correlationId?: string) {
    const change = await this.prisma.catalogChangeRequest.findUnique({ where: { id } });
    if (!change) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Change request not found", 404);
    if (change.status !== "pending") {
      throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This change has already been decided", 409);
    }

    if (input.decision === "reject") {
      return this.prisma.$transaction(async (tx) => {
        const result = await tx.catalogChangeRequest.updateMany({
          where: { id, status: "pending" },
          data: { status: "rejected", decidedByAdminUserId: adminUserId, decidedAt: new Date(), rejectionReason: input.rejectionReason },
        });
        if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This change has already been decided", 409);
        await writeAudit(tx, {
          action: "admin.catalog_change_rejected",
          actorUserId: adminUserId,
          actorType: "admin",
          entityType: "catalog_change_request",
          entityId: id,
          correlationId,
          context: { entityType: change.entityType, reason: input.rejectionReason },
        });
        return tx.catalogChangeRequest.findUniqueOrThrow({ where: { id } });
      });
    }

    // Maker != checker (allowing solo-approval when only one active admin
    // exists — durably flagged via isSoloApproval, never silently
    // indistinguishable from a real second-reviewer approval).
    const activeAdminCount = await this.prisma.adminUser.count({ where: { status: "active" } });
    const isSelfApproval = change.requestedByAdminUserId === adminUserId;
    if (activeAdminCount > 1 && isSelfApproval) {
      throw new ApiProblem(ERROR_CODES.MAKER_CHECKER_CONFLICT, "A different admin must approve this change", 403);
    }
    const isSoloApproval = activeAdminCount <= 1 && isSelfApproval;

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.catalogChangeRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", decidedByAdminUserId: adminUserId, decidedAt: new Date(), isSoloApproval },
      });
      if (result.count === 0) throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This change has already been decided", 409);

      await this.applyChange(tx, change);

      await writeAudit(tx, {
        action: "admin.catalog_change_approved",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "catalog_change_request",
        entityId: id,
        correlationId,
        context: { entityType: change.entityType, operation: change.operation, isSoloApproval },
      });
      return tx.catalogChangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  private async applyChange(
    tx: Tx,
    change: { entityType: string; entityId: string | null; operation: string; proposedData: Prisma.JsonValue },
  ): Promise<void> {
    const data = change.proposedData as Record<string, unknown>;
    const requireOnCreate = (field: string) => {
      if (change.operation === "create" && (data[field] === undefined || data[field] === null || data[field] === "")) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, `${field} is required to create this entity`, 400);
      }
    };

    switch (change.entityType) {
      case "ingredient":
        requireOnCreate("name");
        if (change.operation === "create") await tx.medicationIngredient.create({ data: data as never });
        else if (change.operation === "deprecate") await tx.medicationIngredient.update({ where: { id: change.entityId! }, data: { status: "deprecated" } });
        else await tx.medicationIngredient.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "manufacturer":
        requireOnCreate("name");
        if (change.operation === "create") await tx.manufacturer.create({ data: data as never });
        else if (change.operation === "deprecate") await tx.manufacturer.update({ where: { id: change.entityId! }, data: { status: "deprecated" } });
        else await tx.manufacturer.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "brand":
        requireOnCreate("name");
        if (change.operation === "create") await tx.medicationBrand.create({ data: data as never });
        else if (change.operation === "deprecate") await tx.medicationBrand.update({ where: { id: change.entityId! }, data: { status: "deprecated" } });
        else await tx.medicationBrand.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "dosage_form":
        requireOnCreate("name");
        if (change.operation === "create") await tx.dosageForm.create({ data: data as never });
        else await tx.dosageForm.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "route":
        requireOnCreate("name");
        if (change.operation === "create") await tx.administrationRoute.create({ data: data as never });
        else await tx.administrationRoute.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "classification":
        requireOnCreate("name");
        if (change.operation === "create") await tx.therapeuticClass.create({ data: data as never });
        else await tx.therapeuticClass.update({ where: { id: change.entityId! }, data: data as never });
        return;
      case "product":
        requireOnCreate("genericName");
        if (change.operation === "create") await tx.medicationProduct.create({ data: data as never });
        else if (change.operation === "deprecate") await tx.medicationProduct.update({ where: { id: change.entityId! }, data: { status: "deprecated" } });
        else await tx.medicationProduct.update({ where: { id: change.entityId! }, data: data as never });
        return;
    }
  }
}
