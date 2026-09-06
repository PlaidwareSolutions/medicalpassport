import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { FeatureFlag } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import { featureFlagKeySchema, putFeatureFlagSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";
import { FeatureFlagService } from "../meta/feature-flag.service";

function presentRow(row: FeatureFlag) {
  return {
    key: row.key,
    description: row.description,
    defaultOn: row.defaultOn,
    rolloutPercent: row.rolloutPercent,
    allowProfileIds: row.allowProfileIds,
    environment: row.environment,
    updatedByAdminId: row.updatedByAdminId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: "row" as const,
  };
}

/**
 * Configuration / feature flags (docs_v2/14 §3, super_admin). The editor
 * behind `GET meta/flags`: static env defaults are listed alongside the
 * rows that override them, and every write lands on the audit chain with
 * the admin's note. Allowlisted profile ids are opaque here — the page
 * never resolves them to a person.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/flags")
export class AdminFlagsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagService,
  ) {}

  @Get()
  async list(@Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_flags");
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const defaults = this.flags.staticDefaults();
    const items = [
      ...rows.map(presentRow),
      ...Object.entries(defaults)
        .filter(([key]) => !byKey.has(key))
        .map(([key, defaultOn]) => ({
          key,
          description: null,
          defaultOn,
          rolloutPercent: 0,
          allowProfileIds: [] as string[],
          environment: null,
          updatedByAdminId: null,
          createdAt: null,
          updatedAt: null,
          source: "static" as const,
        })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    return { items, staticDefaults: defaults };
  }

  @Get(":key")
  async byKey(@Param("key") keyRaw: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_flags");
    const key = parseWith(featureFlagKeySchema, keyRaw);
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (row) return presentRow(row);
    const defaults = this.flags.staticDefaults();
    if (!(key in defaults)) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Flag not found", 404);
    return { key, description: null, defaultOn: defaults[key], rolloutPercent: 0, allowProfileIds: [], environment: null, updatedByAdminId: null, createdAt: null, updatedAt: null, source: "static" as const };
  }

  /** Upsert — creating a row for a static key makes the row authoritative. */
  @Put(":key")
  async put(@Param("key") keyRaw: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_flags");
    const key = parseWith(featureFlagKeySchema, keyRaw);
    const { note, ...input } = parseWith(putFeatureFlagSchema, body);
    const adminUserId = req.adminAuth!.adminUserId;

    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.featureFlag.findUnique({ where: { key } });
      const saved = await tx.featureFlag.upsert({
        where: { key },
        create: { key, ...input, environment: input.environment ?? null, updatedByAdminId: adminUserId },
        update: { ...input, environment: input.environment ?? null, updatedByAdminId: adminUserId },
      });
      await writeAudit(tx, {
        action: "admin.flag_updated",
        actorUserId: adminUserId,
        actorType: "admin",
        entityType: "feature_flag",
        correlationId: req.correlationId,
        context: {
          key,
          note,
          created: before === null,
          before: before ? { defaultOn: before.defaultOn, rolloutPercent: before.rolloutPercent, allowCount: before.allowProfileIds.length, environment: before.environment } : null,
          after: { defaultOn: saved.defaultOn, rolloutPercent: saved.rolloutPercent, allowCount: saved.allowProfileIds.length, environment: saved.environment },
        },
      });
      return saved;
    });
    return presentRow(row);
  }
}
