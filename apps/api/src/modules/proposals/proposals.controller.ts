import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { ProfileAction } from "@medpass/authorization";
import type { ProposalKind } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import { acceptProposalSchema, proposalsQuerySchema, rejectProposalSchema } from "@medpass/validation";
import { RequiresStepUp } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor } from "../../common/provenance";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { ProposalsService } from "./proposals.service";
import { emitProductEvent, productEventContext } from "../product-events/product-events.service";

/**
 * The caregiver scope a decision needs is the scope the resulting write
 * would need if the patient made it directly: a reconciliation, discharge
 * or dispense changes medicines; a prescription or encounter is a profile
 * record; a lab report is a test upload.
 */
function decisionActionFor(kind: ProposalKind): ProfileAction {
  switch (kind) {
    case "reconciliation":
    case "discharge_transition":
    case "dispense":
      return "edit_medications";
    case "prescription":
    case "encounter":
      return "edit_profile";
    case "diagnostic_report":
      return "upload_tests";
  }
}

/**
 * The patient's "Proposals" inbox (docs_v2/06 P11-5): everything awaiting
 * acceptance across every organization, and the accept / reject decisions.
 * Accepting is a step-up operation (docs_v2/11 §7 "reconciliation accept").
 */
@Controller()
export class ProposalsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
  ) {}

  @Get("profiles/current/proposals")
  async list(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return this.proposals.listForPatient(profileId, parseWith(proposalsQuerySchema, query));
  }

  @Get("proposals/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return this.proposals.getForPatient(profileId, id);
  }

  @RequiresStepUp()
  @Post("proposals/:id/accept")
  async accept(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.requireDecisionAccess(req, id);
    const input = parseWith(acceptProposalSchema, body ?? {});
    const accepted = await this.proposals.accept(profileId, id, input, {
      userId: req.auth!.userId,
      actorRole,
      recordedVia: recordedViaFor(req),
      correlationId: req.correlationId,
    });
    // Product metrics (docs_v2/06 P1-7): the proposal kind and how many lines were declined — never the lines.
    emitProductEvent({ ...productEventContext(req), name: "network.proposal_accepted", profileId, properties: { kind: String(accepted.kind), declinedLines: input.declinedLines.length } });
    return accepted;
  }

  @Post("proposals/:id/reject")
  async reject(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.requireDecisionAccess(req, id);
    const input = parseWith(rejectProposalSchema, body ?? {});
    return this.proposals.reject(profileId, id, input, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId });
  }

  /** view_profile to find the proposal, then the kind-specific scope to decide on it. */
  private async requireDecisionAccess(req: ApiRequest, id: string) {
    const { profileId } = await this.access.require(req, "view_profile");
    const proposal = await this.prisma.providerProposal.findFirst({ where: { id, patientProfileId: profileId }, select: { kind: true } });
    if (!proposal) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Proposal not found", 404);
    const action = decisionActionFor(proposal.kind);
    const { actorRole } = await this.access.requireForProfile(req.auth!.userId, profileId, action, req.correlationId);
    return { profileId, actorRole };
  }
}
