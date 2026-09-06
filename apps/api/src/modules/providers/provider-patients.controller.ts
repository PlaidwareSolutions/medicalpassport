import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { onboardPatientSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { ProviderGuard, providerContext } from "./provider.guard";
import { PatientLinksService } from "./patient-links.service";

/**
 * Provider side of the relationship (docs_v2/05 §11): redeem a scanned QR
 * token, list linked patients (labels only — no clinical data on the list),
 * and read the Doctor Snapshot within the granted sections. Every read is
 * audited with the organization id (exit gate M11).
 */
@Public()
@UseGuards(ProviderGuard)
@Controller("provider/patients")
export class ProviderPatientsController {
  constructor(private readonly links: PatientLinksService) {}

  @Post("onboard")
  async onboard(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = providerContext(req);
    const input = parseWith(onboardPatientSchema, body);
    return this.links.onboard(input.qrToken, { userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId });
  }

  @Get()
  async list(@Req() req: ApiRequest) {
    const ctx = providerContext(req);
    return { items: await this.links.listForProvider({ userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId }) };
  }

  @Get(":linkId/snapshot")
  async snapshot(@Param("linkId") linkId: string, @Req() req: ApiRequest) {
    const ctx = providerContext(req);
    return this.links.snapshot(linkId, { userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId });
  }
}
