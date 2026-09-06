import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { abdmCareContextLinkSchema, abdmConsentRevokeSchema, abdmDiscoverSchema, abhaLinkInitSchema, abhaLinkVerifySchema } from "@medpass/validation";
import { RequiresStepUp } from "../../common/auth.guard";
import type { ApiRequest } from "../../common/http";
import { ProfileAccessService } from "../../common/profile-access.service";
import { parseWith } from "../../common/zod";
import { AbdmImportService } from "./abdm-import.service";
import { AbdmService, type AbdmActor } from "./abdm.service";

/**
 * ABDM patient-facing routes (docs_v2/05 §10). ABHA is never required to use the product; these
 * routes only exist once the patient chooses to connect one. Identity changes (link init, consent
 * revoke) are step-up guarded (ADR-V2-012); everything is `manage_consents` / `share_records`
 * scoped — a caregiver never links or unlinks a patient's ABHA.
 */
@Controller()
export class AbdmController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly abdm: AbdmService,
    private readonly imports: AbdmImportService,
  ) {}

  // ───────────────────────── ABHA identity ─────────────────────────

  @Get("profiles/current/abha")
  async status(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return this.abdm.status(profileId);
  }

  @Post("profiles/current/abha/link/init")
  @RequiresStepUp()
  @HttpCode(202)
  async linkInit(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    const input = parseWith(abhaLinkInitSchema, body);
    return this.abdm.linkInit(profileId, input, this.actor(req, actorRole));
  }

  @Post("profiles/current/abha/link/verify")
  async linkVerify(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    const input = parseWith(abhaLinkVerifySchema, body);
    return this.abdm.linkVerify(profileId, input, this.actor(req, actorRole));
  }

  @Delete("profiles/current/abha")
  @HttpCode(204)
  async unlink(@Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    await this.abdm.unlink(profileId, this.actor(req, actorRole));
  }

  // ───────────────────────── discovery + care contexts ─────────────────────────

  @Post("profiles/current/abha/discover")
  @HttpCode(202)
  async discover(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    const input = parseWith(abdmDiscoverSchema, body ?? {});
    return this.abdm.discover(profileId, input, this.actor(req, actorRole));
  }

  @Get("profiles/current/abha/discover/:txnId")
  async discoveryResult(@Param("txnId") txnId: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    return this.abdm.discoveryResult(profileId, txnId, this.actor(req, actorRole));
  }

  @Post("profiles/current/abha/care-contexts/link")
  async linkCareContexts(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    const input = parseWith(abdmCareContextLinkSchema, body);
    return this.abdm.linkCareContexts(profileId, input, this.actor(req, actorRole));
  }

  // ───────────────────────── consents + bundles ─────────────────────────

  @Get("profiles/current/abdm/consents")
  async consents(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_consents");
    return { items: await this.abdm.listConsents(profileId) };
  }

  @Post("profiles/current/abdm/consents/:id/revoke")
  @RequiresStepUp()
  async revokeConsent(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_consents");
    const input = parseWith(abdmConsentRevokeSchema, body ?? {});
    return this.abdm.revokeConsent(profileId, id, input, this.actor(req, actorRole));
  }

  @Get("profiles/current/abdm/bundles")
  async bundles(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_documents");
    return { items: await this.abdm.listBundles(profileId) };
  }

  /** Creates candidates only (docs_v2/08 §7) — the confirmation queue does the rest. */
  @Post("abdm/bundles/:id/import")
  async importBundle(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    return this.imports.importBundle(profileId, id, this.actor(req, actorRole));
  }

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver"): AbdmActor {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId };
  }
}
