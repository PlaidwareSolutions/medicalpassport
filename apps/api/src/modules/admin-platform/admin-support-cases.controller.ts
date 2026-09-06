import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { Prisma, SupportCase, SupportCaseNote } from "@medpass/database";
import { ERROR_CODES, type AuditAction } from "@medpass/domain";
import { createSupportCaseSchema, supportCaseNoteSchema, supportCasesQuerySchema, updateSupportCaseSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

function presentCase(row: SupportCase & { _count?: { notes: number } }) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    channel: row.channel,
    /** Opaque: the page never resolves it to a person. */
    patientProfileId: row.patientProfileId,
    openedByUserId: row.openedByUserId,
    assignedAdminId: row.assignedAdminId,
    noteCount: row._count?.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentNote(row: SupportCaseNote) {
  return { id: row.id, authorAdminId: row.authorAdminId, body: row.body, createdAt: row.createdAt.toISOString() };
}

/**
 * Support cases (docs_v2/14 §3 and §5, `support_cases` duty). A case is an
 * operational record — subject, status, channel, assignee, notes — that
 * points at a patient profile by opaque id only. Nothing clinical is
 * readable through it; the only path to a record is a separate,
 * time-boxed, audited break-glass grant (admin-break-glass.controller.ts).
 * Every write lands on the audit chain, against the profile when one is
 * attached so the patient's own audit trail shows the case existed.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/support-cases")
export class AdminSupportCasesController {
  constructor(private readonly prisma: PrismaService) {}

  private async audit(tx: Prisma.TransactionClient, req: ApiRequest, action: AuditAction, row: SupportCase, context: Record<string, unknown>) {
    await writeAudit(tx, {
      action,
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      entityType: "support_case",
      entityId: row.id,
      patientProfileId: row.patientProfileId ?? undefined,
      correlationId: req.correlationId,
      context,
    });
  }

  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_support_cases");
    const input = parseWith(supportCasesQuerySchema, query);
    const rows = await this.prisma.supportCase.findMany({
      where: { status: input.status, patientProfileId: input.patientProfileId, assignedAdminId: input.assignedAdminId },
      include: { _count: { select: { notes: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, input.limit);
    const byStatus = await this.prisma.supportCase.groupBy({ by: ["status"], _count: true });
    return {
      items: page.map(presentCase),
      nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      totals: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    };
  }

  @Get(":id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_support_cases");
    const row = await this.prisma.supportCase.findUnique({ where: { id }, include: { notes: { orderBy: { createdAt: "asc" } }, _count: { select: { notes: true } } } });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
    const grants = row.patientProfileId
      ? await this.prisma.breakGlassGrant.findMany({ where: { supportCaseId: row.id }, orderBy: { grantedAt: "desc" }, take: 10 })
      : [];
    return {
      ...presentCase(row),
      notes: row.notes.map(presentNote),
      breakGlassGrants: grants.map((g) => ({
        id: g.id,
        adminUserId: g.adminUserId,
        grantedAt: g.grantedAt.toISOString(),
        expiresAt: g.expiresAt.toISOString(),
        revokedAt: g.revokedAt?.toISOString() ?? null,
        active: g.revokedAt === null && g.expiresAt > new Date(),
      })),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_support_cases");
    const input = parseWith(createSupportCaseSchema, body);
    if (input.patientProfileId) {
      const profile = await this.prisma.patientProfile.findFirst({ where: { id: input.patientProfileId, deletedAt: null }, select: { id: true } });
      if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportCase.create({
        data: {
          subject: input.subject,
          channel: input.channel,
          patientProfileId: input.patientProfileId ?? null,
          assignedAdminId: input.assignedAdminId ?? null,
          status: "open",
        },
      });
      await this.audit(tx, req, "admin.support_case_created", created, { channel: created.channel, hasProfile: created.patientProfileId !== null });
      return created;
    });
    return presentCase(row);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_support_cases");
    const input = parseWith(updateSupportCaseSchema, body);
    const existing = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportCase.update({ where: { id }, data: input });
      await this.audit(tx, req, "admin.support_case_updated", updated, { fields: Object.keys(input), status: updated.status, previousStatus: existing.status });
      return updated;
    });
    return presentCase(row);
  }

  @Post(":id/notes")
  async addNote(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "manage_support_cases");
    const input = parseWith(supportCaseNoteSchema, body);
    const existing = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Support case not found", 404);
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportCaseNote.create({ data: { caseId: id, authorAdminId: req.adminAuth!.adminUserId, body: input.body } });
      await tx.supportCase.update({ where: { id }, data: { updatedAt: new Date() } });
      // Length only — the note body itself is never copied into the chain.
      await this.audit(tx, req, "admin.support_case_note_added", existing, { noteId: created.id, length: input.body.length });
      return created;
    });
    return presentNote(note);
  }
}
