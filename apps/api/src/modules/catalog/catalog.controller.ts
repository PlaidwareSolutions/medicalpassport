import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { catalogSearchSchema } from "@medpass/validation";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";

/**
 * Medication catalog search (non-PHI). Requires authentication and is
 * rate-limit protected at the edge + app; responses are per-user cacheable
 * only (docs/14). Query text is never logged or sent to analytics.
 */
@Controller("catalog")
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("products")
  async search(@Query() query: Record<string, string>, @Req() _req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseWith(catalogSearchSchema, query);
    res.setHeader("cache-control", "private, max-age=300");

    const q = input.q;
    const products = await this.prisma.medicationProduct.findMany({
      where: {
        status: "active",
        OR: [
          { brand: { is: { name: { contains: q, mode: "insensitive" } } } },
          { brand: { is: { aliases: { has: q } } } },
          { genericName: { contains: q, mode: "insensitive" } },
          { ingredients: { some: { ingredient: { name: { contains: q, mode: "insensitive" } } } } },
        ],
      },
      include: {
        brand: true,
        dosageForm: true,
        ingredients: { include: { ingredient: true } },
      },
      take: input.limit,
      orderBy: { genericName: "asc" },
    });

    return {
      items: products.map((p) => this.toDto(p)),
    };
  }

  @Get("products/:id")
  async byId(@Param("id") id: string) {
    const product = await this.prisma.medicationProduct.findFirst({
      where: { id, status: "active" },
      include: { brand: true, dosageForm: true, ingredients: { include: { ingredient: true } } },
    });
    if (!product) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    return this.toDto(product);
  }

  private toDto(p: {
    id: string;
    genericName: string;
    strengthLabel: string | null;
    isCombination: boolean;
    brand: { name: string } | null;
    dosageForm: { name: string } | null;
    ingredients: Array<{ ingredient: { name: string }; strengthValue: unknown; strengthUnit: string | null }>;
  }) {
    return {
      id: p.id,
      brandName: p.brand?.name ?? null,
      genericName: p.genericName,
      strengthLabel: p.strengthLabel,
      form: p.dosageForm?.name ?? null,
      isCombination: p.isCombination,
      ingredients: p.ingredients.map((i) => ({
        name: i.ingredient.name,
        strength: i.strengthValue != null ? `${i.strengthValue} ${i.strengthUnit ?? ""}`.trim() : null,
      })),
    };
  }
}
