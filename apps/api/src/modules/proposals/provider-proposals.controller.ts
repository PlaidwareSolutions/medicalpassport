import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { ProposalKind } from "@medpass/database";
import {
  proposeDiagnosticReportSchema,
  proposeDischargeSchema,
  proposeDispenseSchema,
  proposeEncounterSchema,
  proposePrescriptionSchema,
  proposeReconciliationSchema,
} from "@medpass/validation";
import type { ZodTypeAny } from "zod";
import { Public } from "../../common/auth.guard";
import { rejectClientProvenance } from "../../common/provenance";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { ProviderGuard, providerContext } from "../providers/provider.guard";
import { ProposalsService } from "./proposals.service";

/**
 * Provider-side proposals (docs_v2/05 §11, ADR-V2-009). Each route stores
 * one `ProviderProposal` and nothing else — the organization kind decides
 * which routes it may use (clinic/hospital: reconciliations, prescriptions,
 * encounters; hospital: discharge; pharmacy: dispenses; laboratory:
 * diagnostic reports). Provenance is never client-supplied.
 */
@Public()
@UseGuards(ProviderGuard)
@Controller("provider")
export class ProviderProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  private async propose(kind: ProposalKind, schema: ZodTypeAny, linkId: string, body: unknown, req: ApiRequest) {
    const ctx = providerContext(req);
    rejectClientProvenance(body);
    const payload = parseWith(schema, body);
    return this.proposals.create(kind, linkId, payload, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      organizationKind: ctx.organizationKind,
      correlationId: req.correlationId,
    });
  }

  @Post("patients/:linkId/reconciliations")
  reconciliation(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("reconciliation", proposeReconciliationSchema, linkId, body, req);
  }

  @Post("patients/:linkId/prescriptions")
  prescription(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("prescription", proposePrescriptionSchema, linkId, body, req);
  }

  @Post("patients/:linkId/encounters")
  encounter(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("encounter", proposeEncounterSchema, linkId, body, req);
  }

  @Post("patients/:linkId/dispenses")
  dispense(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("dispense", proposeDispenseSchema, linkId, body, req);
  }

  @Post("patients/:linkId/diagnostic-reports")
  diagnosticReport(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("diagnostic_report", proposeDiagnosticReportSchema, linkId, body, req);
  }

  @Post("patients/:linkId/discharge")
  discharge(@Param("linkId") linkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.propose("discharge_transition", proposeDischargeSchema, linkId, body, req);
  }

  /** Everything this organization proposed for the patient, with status — the provider's view of acceptance. */
  @Get("patients/:linkId/proposals")
  async listForLink(@Param("linkId") linkId: string, @Req() req: ApiRequest) {
    const ctx = providerContext(req);
    return {
      items: await this.proposals.listForLink(linkId, {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        organizationKind: ctx.organizationKind,
        correlationId: req.correlationId,
      }),
    };
  }

  @Get("proposals/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = providerContext(req);
    return this.proposals.getForProvider(id, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      organizationKind: ctx.organizationKind,
      correlationId: req.correlationId,
    });
  }
}
