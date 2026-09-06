import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { createOnboardingTokenSchema } from "@medpass/validation";
import { RequiresStepUp } from "../../common/auth.guard";
import { ProfileAccessService } from "../../common/profile-access.service";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { PatientLinksService } from "./patient-links.service";

/**
 * Patient side of provider access (docs_v2/05 §11): mint the QR onboarding
 * token, see which organizations hold a link, and revoke one. Minting and
 * revoking are step-up operations (docs_v2/11 §7 "provider link revoke";
 * minting hands a clinic the same access a share would).
 */
@Controller()
export class PatientLinksController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly links: PatientLinksService,
  ) {}

  @RequiresStepUp()
  @Post("profiles/current/onboarding-tokens")
  async createOnboardingToken(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "share_records");
    const input = parseWith(createOnboardingTokenSchema, body);
    return this.links.createOnboardingToken(profileId, input, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId });
  }

  @Get("profiles/current/provider-links")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return { items: await this.links.listForPatient(profileId) };
  }

  @RequiresStepUp()
  @Post("provider-links/:id/revoke")
  async revoke(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "share_records");
    return this.links.revoke(profileId, id, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId });
  }
}
