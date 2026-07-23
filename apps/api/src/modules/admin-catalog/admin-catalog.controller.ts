import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { CATALOG_ENTITY_TYPES, type CatalogEntityType } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

interface Page {
  items: unknown[];
  nextCursor: string | null;
}

/**
 * Read-only catalog browsing for the admin portal (docs/06). Deliberately
 * separate from the patient-facing CatalogController: this one includes
 * deprecated/banned rows and has no rate limit (internal tool only). Each
 * entity type gets its own query below rather than one generic Prisma
 * delegate helper — MedicationProduct's searchable field is `genericName`,
 * not `name` like the other six, so the shapes genuinely aren't uniform.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/catalog")
export class AdminCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":entityType")
  async list(
    @Param("entityType") entityType: string,
    @Query("q") q: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() req: ApiRequest,
  ): Promise<Page> {
    requireAdminDuty(req, "read_catalog");
    const type = this.parseEntityType(entityType);
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skip: number | undefined = cursor ? 1 : undefined;
    const cursorObj: { id: string } | undefined = cursor ? { id: cursor } : undefined;

    switch (type) {
      case "ingredient":
        return this.paginate(
          await this.prisma.medicationIngredient.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "manufacturer":
        return this.paginate(
          await this.prisma.manufacturer.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "brand":
        return this.paginate(
          await this.prisma.medicationBrand.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            include: { manufacturer: true },
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "dosage_form":
        return this.paginate(
          await this.prisma.dosageForm.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "route":
        return this.paginate(
          await this.prisma.administrationRoute.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "classification":
        return this.paginate(
          await this.prisma.therapeuticClass.findMany({
            where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { name: "asc" },
            take: take + 1,
            cursor: cursorObj,
            skip,
          }),
          take,
        );
      case "product":
        return this.paginate(
          await this.prisma.medicationProduct.findMany({
            where: q ? { genericName: { contains: q, mode: "insensitive" } } : undefined,
            orderBy: { genericName: "asc" },
            take: take + 1,
            include: { brand: true, dosageForm: true, route: true, ingredients: { include: { ingredient: true } } },
            cursor: cursorObj,
            skip,
          }),
          take,
        );
    }
  }

  @Get(":entityType/:id")
  async detail(@Param("entityType") entityType: string, @Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "read_catalog");
    const type = this.parseEntityType(entityType);
    const entity = await this.findOne(type, id);
    if (!entity) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Not found", 404);
    const changes = await this.prisma.catalogChangeRequest.findMany({
      where: { entityType: type, entityId: id },
      orderBy: { createdAt: "desc" },
    });
    return { entity, changes };
  }

  private async findOne(type: CatalogEntityType, id: string) {
    switch (type) {
      case "ingredient":
        return this.prisma.medicationIngredient.findUnique({ where: { id } });
      case "manufacturer":
        return this.prisma.manufacturer.findUnique({ where: { id } });
      case "brand":
        return this.prisma.medicationBrand.findUnique({ where: { id }, include: { manufacturer: true } });
      case "dosage_form":
        return this.prisma.dosageForm.findUnique({ where: { id } });
      case "route":
        return this.prisma.administrationRoute.findUnique({ where: { id } });
      case "classification":
        return this.prisma.therapeuticClass.findUnique({ where: { id } });
      case "product":
        return this.prisma.medicationProduct.findUnique({
          where: { id },
          include: { brand: true, dosageForm: true, route: true, ingredients: { include: { ingredient: true } } },
        });
    }
  }

  private paginate<T extends { id: string }>(items: T[], take: number): Page {
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  private parseEntityType(value: string): CatalogEntityType {
    if (!(CATALOG_ENTITY_TYPES as readonly string[]).includes(value)) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown catalog entity type", 400);
    }
    return value as CatalogEntityType;
  }
}
