import { Injectable } from "@nestjs/common";
import { writeAudit, writeAuditDeferred } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { Prisma, ProposalKind, ProviderProposal } from "@medpass/database";
import type { AcceptProposalInput, ProposalsQuery, RejectProposalInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { PatientLinksService, linkSections } from "../providers/patient-links.service";
import { PROPOSAL_KINDS_BY_ORGANIZATION } from "../providers/provider-organizations.service";
import { ProposalApplyService } from "./proposal-apply.service";

export interface ProviderActor {
  userId: string;
  organizationId: string;
  organizationKind: string;
  correlationId?: string;
}

export interface PatientActor {
  userId: string;
  actorRole: "patient" | "caregiver";
  recordedVia?: string;
  correlationId?: string;
}

type ProposalRow = ProviderProposal & { link: { organization: { id: string; displayName: string; kind: string } } };

const PROPOSAL_INCLUDE = { link: { include: { organization: { select: { id: true, displayName: true, kind: true } } } } } as const;

function proposalDto(p: ProposalRow) {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    linkId: p.linkId,
    organization: p.link.organization,
    payload: p.payload,
    proposedAt: p.createdAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
    resultingEntityType: p.resultingEntityType,
    resultingEntityId: p.resultingEntityId,
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Medicine ids a proposal payload refers to — they must be the patient's own, and visible through the link. */
function referencedMedicationIds(kind: ProposalKind, payload: unknown): string[] {
  const p = payload as { lines?: Array<{ patientMedicationId?: string | null }>; patientMedicationId?: string | null };
  if (kind === "dispense") return p.patientMedicationId ? [p.patientMedicationId] : [];
  if (kind === "reconciliation" || kind === "discharge_transition") {
    return [...new Set((p.lines ?? []).map((l) => l.patientMedicationId).filter((id): id is string => typeof id === "string"))];
  }
  return [];
}

/**
 * Providers propose, patients accept (ADR-V2-009). A proposal is a
 * `ProviderProposal` row carrying its validated payload; the clinical
 * tables are untouched until `accept()`. The provider sees status; the
 * patient (or a caregiver with the matching scope) decides.
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PatientLinksService,
    private readonly apply: ProposalApplyService,
  ) {}

  // ───────────────────────── provider side ─────────────────────────

  async create(kind: ProposalKind, linkId: string, payload: unknown, actor: ProviderActor) {
    const allowed = PROPOSAL_KINDS_BY_ORGANIZATION[actor.organizationKind] ?? [];
    if (!allowed.includes(kind)) {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, `A ${actor.organizationKind.replace("_", " ")} cannot send a ${kind.replace("_", " ")} proposal`, 403);
    }
    const link = await this.links.requireActiveLink(linkId, actor.organizationId);

    const medicationIds = referencedMedicationIds(kind, payload);
    if (medicationIds.length > 0) {
      // Referring to a medicine by id means the provider saw it — which
      // only happens through a link that grants the medications section.
      if (!linkSections(link).includes("medications")) {
        throw new ApiProblem(ERROR_CODES.FORBIDDEN, "This link does not share the patient's medicines", 403);
      }
      const known = await this.prisma.patientMedication.count({
        where: { id: { in: medicationIds }, patientProfileId: link.patientProfileId, deletedAt: null },
      });
      if (known !== medicationIds.length) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "A line refers to a medicine that is not on this patient's list", 400, [
          { path: "patientMedicationId", message: "Unknown medicine" },
        ]);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerProposal.create({
        data: {
          linkId: link.id,
          organizationId: actor.organizationId,
          patientProfileId: link.patientProfileId,
          kind,
          payload: payload as Prisma.InputJsonValue,
          proposedByUserId: actor.userId,
        },
        include: PROPOSAL_INCLUDE,
      });
      await writeAudit(tx, {
        action: "provider.proposal_created",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "provider_proposal",
        entityId: row.id,
        patientProfileId: link.patientProfileId,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId, kind, linkId: link.id },
      });
      return row;
    });
    return proposalDto(created);
  }

  async listForLink(linkId: string, actor: ProviderActor) {
    const link = await this.links.requireActiveLink(linkId, actor.organizationId);
    const rows = await this.prisma.providerProposal.findMany({
      where: { linkId: link.id, organizationId: actor.organizationId },
      include: PROPOSAL_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    return rows.map(proposalDto);
  }

  async getForProvider(id: string, actor: ProviderActor) {
    const row = await this.prisma.providerProposal.findFirst({ where: { id, organizationId: actor.organizationId }, include: PROPOSAL_INCLUDE });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Proposal not found", 404);
    await writeAuditDeferred(this.prisma, {
      action: "provider.proposal_viewed",
      actorUserId: actor.userId,
      actorType: "provider",
      entityType: "provider_proposal",
      entityId: row.id,
      patientProfileId: row.patientProfileId,
      correlationId: actor.correlationId,
      context: { organizationId: actor.organizationId, kind: row.kind, status: row.status },
    });
    return proposalDto(row);
  }

  // ───────────────────────── patient side ─────────────────────────

  async listForPatient(profileId: string, query: ProposalsQuery) {
    const rows = await this.prisma.providerProposal.findMany({
      where: { patientProfileId: profileId, ...(query.status ? { status: query.status } : {}) },
      include: PROPOSAL_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return { items: page.map(proposalDto), nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
  }

  async getForPatient(profileId: string, id: string) {
    const row = await this.prisma.providerProposal.findFirst({ where: { id, patientProfileId: profileId }, include: PROPOSAL_INCLUDE });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Proposal not found", 404);
    return proposalDto(row);
  }

  /** The proposal, or 404; 400 `invalid_status_transition` when it was already decided. */
  private async requireOpen(profileId: string, id: string): Promise<ProposalRow> {
    const row = await this.prisma.providerProposal.findFirst({ where: { id, patientProfileId: profileId }, include: PROPOSAL_INCLUDE });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Proposal not found", 404);
    if (row.status !== "proposed") {
      throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, `This proposal was already ${row.status}`, 400);
    }
    return row;
  }

  async accept(profileId: string, id: string, input: AcceptProposalInput, actor: PatientActor) {
    const proposal = await this.requireOpen(profileId, id);
    const lineCount = Array.isArray((proposal.payload as { lines?: unknown[] })?.lines) ? (proposal.payload as { lines: unknown[] }).lines.length : 0;
    const declined = new Set(input.declinedLines.filter((i) => i < lineCount));
    if (lineCount > 0 && declined.size === lineCount) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Every line was declined — reject the proposal instead", 400, [
        { path: "declinedLines", message: "Nothing left to accept" },
      ]);
    }

    const result = await this.apply.apply(proposal, {
      userId: actor.userId,
      actorRole: actor.actorRole,
      recordedVia: actor.recordedVia,
      correlationId: actor.correlationId,
      organization: proposal.link.organization,
      declinedLines: declined,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerProposal.update({
        where: { id: proposal.id },
        data: {
          status: "accepted",
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          resultingEntityType: result.entityType,
          resultingEntityId: result.entityId,
        },
        include: PROPOSAL_INCLUDE,
      });
      await writeAudit(tx, {
        action: "provider.proposal_accepted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "provider_proposal",
        entityId: proposal.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { organizationId: proposal.organizationId, kind: proposal.kind, declinedLines: [...declined], ...result.summary },
      });
      return row;
    });
    return { ...proposalDto(updated), applied: result.summary };
  }

  async reject(profileId: string, id: string, input: RejectProposalInput, actor: PatientActor) {
    const proposal = await this.requireOpen(profileId, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerProposal.update({
        where: { id: proposal.id },
        data: { status: "rejected", decidedByUserId: actor.userId, decidedAt: new Date() },
        include: PROPOSAL_INCLUDE,
      });
      await writeAudit(tx, {
        action: "provider.proposal_rejected",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "provider_proposal",
        entityId: proposal.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // The reason is free text the patient wrote; only its presence is logged.
        context: { organizationId: proposal.organizationId, kind: proposal.kind, hasReason: Boolean(input.reason) },
      });
      return row;
    });
    return proposalDto(updated);
  }
}
