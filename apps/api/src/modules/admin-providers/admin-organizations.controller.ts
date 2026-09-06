import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { Prisma } from "@medpass/database";
import { ERROR_CODES, type AuditAction } from "@medpass/domain";
import {
  adminCreateOrganizationSchema,
  adminOrganizationsQuerySchema,
  adminPractitionersQuerySchema,
  adminUpdateOrganizationSchema,
  adminVerifyOrganizationSchema,
  adminVerifyPractitionerSchema,
  mergeOrganizationSchema,
  type AdminDirectoryScope,
} from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

type Tx = Prisma.TransactionClient;

const ORG_COUNTS = {
  _count: { select: { practitioners: { where: { deletedAt: null } }, encounters: { where: { deletedAt: null } } } },
} as const;
type OrgRow = Prisma.OrganizationGetPayload<{ include: typeof ORG_COUNTS }>;

const PRACTITIONER_COUNTS = {
  _count: {
    select: {
      medications: { where: { deletedAt: null } },
      prescriptions: { where: { deletedAt: null } },
      medicalReports: { where: { deletedAt: null } },
      encounters: { where: { deletedAt: null } },
    },
  },
} as const;
type PractitionerRow = Prisma.PractitionerGetPayload<{ include: typeof PRACTITIONER_COUNTS }>;

/**
 * Provider / facility directory administration (docs_v2/14 §3, docs_v2/04
 * §3.1–3.2, Phase 1 WP P1-6), gated by the provider_admin duty.
 *
 * Two kinds of rows share the Organization / Practitioner tables:
 *  - GLOBAL directory entries (`patientProfileId` / `createdByProfileId`
 *    null) — created, edited, verified and merged here in full.
 *  - PATIENT-SCOPED rows a patient typed in ("Apollo Clinic, Jubilee
 *    Hills", "Dr. Rao") — these are part of the patient record. Admins
 *    see them ONLY as `{ id, patientScoped: true, kind, verification,
 *    counts }`: no display name, no address, no phone, no profile id.
 *    The `q` filter never matches them either, so a name cannot be
 *    confirmed by searching for it. Verification (HFR/HPR) is the one
 *    write allowed on a patient-scoped row, and it is audited against
 *    the patient profile so it shows in that patient's own audit trail.
 *
 * Every write lands on the audit chain with actorType "admin".
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin")
export class AdminOrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── Organizations ─────────────────────────

  @Get("organizations")
  async listOrganizations(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminOrganizationsQuerySchema, query);
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...scopeWhere("patientProfileId", input.scope),
      ...(input.kind ? { kind: input.kind } : {}),
      // Name search is restricted to global entries — see class doc.
      ...(input.q ? { patientProfileId: null, displayName: { contains: input.q, mode: "insensitive" } } : {}),
    };
    const rows = await this.prisma.organization.findMany({
      where,
      include: ORG_COUNTS,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const [globalTotal, patientTotal] = await Promise.all([
      this.prisma.organization.count({ where: { deletedAt: null, patientProfileId: null } }),
      this.prisma.organization.count({ where: { deletedAt: null, patientProfileId: { not: null } } }),
    ]);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map(presentOrganization),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      totals: { global: globalTotal, patient: patientTotal },
    };
  }

  @Post("organizations")
  async createOrganization(@Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminCreateOrganizationSchema, body);
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.organization.create({
        data: { ...input, patientProfileId: null, verification: "unverified" },
      });
      await this.audit(tx, req, "organization.created", "organization", row.id, null, { scope: "global", kind: row.kind });
      return row.id;
    });
    return presentOrganization(await this.prisma.organization.findUniqueOrThrow({ where: { id }, include: ORG_COUNTS }));
  }

  @Patch("organizations/:id")
  async updateOrganization(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminUpdateOrganizationSchema, body);
    await this.requireGlobalOrganization(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: input });
      await this.audit(tx, req, "organization.updated", "organization", id, null, { fields: Object.keys(input) });
    });
    return presentOrganization(await this.prisma.organization.findUniqueOrThrow({ where: { id }, include: ORG_COUNTS }));
  }

  /** Records the ABDM Health Facility Registry id — the only path that sets `hfrId` and lifts verification to provider_verified. */
  @Post("organizations/:id/verify")
  async verifyOrganization(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminVerifyOrganizationSchema, body);
    const existing = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Organization not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await withUniqueGuard("HFR id", () =>
        tx.organization.update({ where: { id }, data: { hfrId: input.hfrId, verification: "provider_verified" } }),
      );
      await this.audit(tx, req, "organization.verified", "organization", id, existing.patientProfileId, {
        registry: "hfr",
        previousVerification: existing.verification,
        patientScoped: existing.patientProfileId !== null,
      });
    });
    return presentOrganization(await this.prisma.organization.findUniqueOrThrow({ where: { id }, include: ORG_COUNTS }));
  }

  /** Global rows only: repoints every link from :id onto `intoId`, then soft-deletes :id with `mergedIntoId` set. */
  @Post("organizations/:id/merge")
  async mergeOrganization(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const { intoId } = parseWith(mergeOrganizationSchema, body);
    if (id === intoId) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Cannot merge an organization into itself", 400);
    await this.requireGlobalOrganization(id);
    await this.requireGlobalOrganization(intoId);
    await this.prisma.$transaction(async (tx) => {
      const moved = {
        encounters: (await tx.encounter.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        practitioners: (await tx.practitioner.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        immunizations: (await tx.immunization.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        procedures: (await tx.procedure.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
      };
      await tx.organization.update({ where: { id }, data: { mergedIntoId: intoId, deletedAt: new Date() } });
      await this.audit(tx, req, "organization.merged", "organization", id, null, { intoId, ...moved });
    });
    return presentOrganization(await this.prisma.organization.findUniqueOrThrow({ where: { id: intoId }, include: ORG_COUNTS }));
  }

  // ───────────────────────── Practitioners ─────────────────────────

  @Get("practitioners")
  async listPractitioners(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminPractitionersQuerySchema, query);
    const where: Prisma.PractitionerWhereInput = {
      deletedAt: null,
      ...scopeWhere("createdByProfileId", input.scope),
      ...(input.q
        ? {
            createdByProfileId: null,
            OR: [
              { displayName: { contains: input.q, mode: "insensitive" } },
              { registrationNumber: { contains: input.q, mode: "insensitive" } },
              { hprId: { contains: input.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.practitioner.findMany({
      where,
      include: PRACTITIONER_COUNTS,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const [globalTotal, patientTotal] = await Promise.all([
      this.prisma.practitioner.count({ where: { deletedAt: null, createdByProfileId: null } }),
      this.prisma.practitioner.count({ where: { deletedAt: null, createdByProfileId: { not: null } } }),
    ]);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map(presentPractitioner),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      totals: { global: globalTotal, patient: patientTotal },
    };
  }

  /** Records the ABDM Health Professional Registry id — the only path that sets `hprId` and lifts verification to provider_verified. */
  @Post("practitioners/:id/verify")
  async verifyPractitioner(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_providers");
    const input = parseWith(adminVerifyPractitionerSchema, body);
    const existing = await this.prisma.practitioner.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Practitioner not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await withUniqueGuard("HPR id", () =>
        tx.practitioner.update({
          where: { id },
          data: {
            hprId: input.hprId,
            verification: "provider_verified",
            ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber } : {}),
            ...(input.registrationCouncil !== undefined ? { registrationCouncil: input.registrationCouncil } : {}),
          },
        }),
      );
      await this.audit(tx, req, "practitioner.verified", "practitioner", id, existing.createdByProfileId, {
        registry: "hpr",
        previousVerification: existing.verification,
        patientScoped: existing.createdByProfileId !== null,
      });
    });
    return presentPractitioner(await this.prisma.practitioner.findUniqueOrThrow({ where: { id }, include: PRACTITIONER_COUNTS }));
  }

  // ───────────────────────── helpers ─────────────────────────

  private async requireGlobalOrganization(id: string): Promise<OrgRow> {
    const row = await this.prisma.organization.findFirst({ where: { id, deletedAt: null }, include: ORG_COUNTS });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Organization not found", 404);
    if (row.patientProfileId !== null) {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "This entry belongs to a patient record and can only be verified, not edited or merged, from admin", 403);
    }
    return row;
  }

  private audit(
    tx: Tx,
    req: ApiRequest,
    action: AuditAction,
    entityType: "organization" | "practitioner",
    entityId: string,
    patientProfileId: string | null,
    context: Record<string, unknown>,
  ) {
    return writeAudit(tx, {
      action,
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      entityType,
      entityId,
      ...(patientProfileId ? { patientProfileId } : {}),
      correlationId: req.correlationId,
      context,
    });
  }
}

function scopeWhere(column: "patientProfileId" | "createdByProfileId", scope: AdminDirectoryScope): Record<string, null | { not: null }> {
  if (scope === "global") return { [column]: null };
  if (scope === "patient") return { [column]: { not: null } };
  return {};
}

/** Translates a unique-index violation (hfr_id / hpr_id) into a 409 instead of a 500. */
async function withUniqueGuard<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, `That ${label} is already assigned to another entry`, 409);
    }
    throw err;
  }
}

/** PHI boundary: a patient-scoped row is reduced to its opaque id, kind, verification and counts. */
function presentOrganization(row: OrgRow) {
  const counts = { practitionerCount: row._count.practitioners, encounterCount: row._count.encounters };
  if (row.patientProfileId !== null) {
    return { id: row.id, patientScoped: true as const, kind: row.kind, verification: row.verification, hfrId: row.hfrId, ...counts, createdAt: row.createdAt.toISOString() };
  }
  return {
    id: row.id,
    patientScoped: false as const,
    kind: row.kind,
    displayName: row.displayName,
    addressText: row.addressText,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    hfrId: row.hfrId,
    verification: row.verification,
    mergedIntoId: row.mergedIntoId,
    ...counts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentPractitioner(row: PractitionerRow) {
  const counts = {
    medicationCount: row._count.medications,
    prescriptionCount: row._count.prescriptions,
    reportCount: row._count.medicalReports,
    encounterCount: row._count.encounters,
  };
  if (row.createdByProfileId !== null) {
    return { id: row.id, patientScoped: true as const, verification: row.verification, hprId: row.hprId, ...counts, createdAt: row.createdAt.toISOString() };
  }
  return {
    id: row.id,
    patientScoped: false as const,
    displayName: row.displayName,
    speciality: row.speciality,
    registrationNumber: row.registrationNumber,
    registrationCouncil: row.registrationCouncil,
    hprId: row.hprId,
    organizationId: row.organizationId,
    verification: row.verification,
    ...counts,
    createdAt: row.createdAt.toISOString(),
  };
}
