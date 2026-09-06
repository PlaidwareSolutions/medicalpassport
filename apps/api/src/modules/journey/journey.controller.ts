import { Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { beforeAfterQuerySchema, clinicalRelationshipsQuerySchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor } from "../../common/provenance";
import { parseWith } from "../../common/zod";
import { ClinicalRelationshipsService } from "./clinical-relationships.service";
import { JourneyService } from "./journey.service";

/**
 * Treatment journey (docs_v2/06 P10).
 *
 * Reads are gated like the clinical profile they extend (`view_profile` for
 * the condition and its relationship graph); the before/after view
 * additionally requires the scope that owns the numbers it reads, because a
 * caregiver allowed to see medicines is not thereby allowed to see lab
 * results (docs_v2/04 §2.2). Confirming or dismissing a suggested link is an
 * `edit_profile` write — the patient (or a caregiver trusted to manage the
 * profile) answering a question about their own record.
 *
 * No `@RequiresStepUp()`: answering a suggestion is not one of the sensitive
 * operations in docs_v2/11 §7, and nothing here discloses data outside the
 * account.
 */
@Controller()
export class JourneyController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly relationships: ClinicalRelationshipsService,
    private readonly journey: JourneyService,
  ) {}

  @Get("profiles/current/clinical-relationships")
  async list(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "view_profile");
    const parsed = parseWith(clinicalRelationshipsQuerySchema, query);
    return { items: await this.relationships.list(profileId, parsed, this.actor(req, actorRole)) };
  }

  @Post("clinical-relationships/:id/confirm")
  async confirm(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    return this.relationships.confirm(profileId, id, this.actor(req, actorRole));
  }

  @Post("clinical-relationships/:id/dismiss")
  async dismiss(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    return this.relationships.dismiss(profileId, id, this.actor(req, actorRole));
  }

  /**
   * The condition hub payload (P10-3). Sections the caller's scopes do not
   * cover come back empty with `sections` saying so, rather than failing the
   * whole screen.
   */
  @Get("profiles/current/conditions/:id/journey")
  async conditionHub(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "view_profile");
    const sections = await this.journey.sectionAccess(req.auth!.userId, profileId, req.profileContext?.caregiverScopes ?? []);
    return this.journey.conditionHub(profileId, id, sections, this.actor(req, actorRole));
  }

  /**
   * The numbers around one medicine's start date and at roughly 30 and 90
   * days after it. The response carries the readings and the window bounds
   * only — never a difference, a percentage or a verdict (docs_v2/10 §1).
   */
  @Get("medications/:id/before-after")
  async beforeAfter(@Param("id") id: string, @Query() query: unknown, @Req() req: ApiRequest) {
    const parsed = parseWith(beforeAfterQuerySchema, query);
    const { profileId } = await this.access.require(req, "view_medications");
    // The second gate is the one that owns the readings themselves.
    await this.access.requireForProfile(req.auth!.userId, profileId, parsed.analyteKey ? "view_tests" : "view_measurements", req.correlationId);
    return this.journey.beforeAfter(profileId, id, parsed);
  }

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver") {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) };
  }
}
