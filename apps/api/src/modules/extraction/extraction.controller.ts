import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import { confirmCandidateSchema, createMedicationFromExtractionSchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { IdempotencyService } from "../../common/idempotency.service";
import { ExtractionService } from "./extraction.service";

@Controller()
export class ExtractionController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly extraction: ExtractionService,
  ) {}

  @Post("documents/:id/process")
  async process(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    return this.extraction.process(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("documents/:id/extraction")
  async get(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_medications");
    return this.extraction.get(profileId, id);
  }

  @Post("extraction-candidates/:id/confirm")
  async confirm(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    const input = parseWith(confirmCandidateSchema, body);
    return this.extraction.confirmCandidate(profileId, id, input.confirmedValue, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Post("extraction-candidates/:id/reject")
  async reject(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    return this.extraction.rejectCandidate(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  /** Sensitive write: requires Idempotency-Key (docs/14). */
  @Post("extractions/:id/create-medication")
  async createMedication(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: ApiRequest,
  ) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    const input = parseWith(createMedicationFromExtractionSchema, body);
    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "patient_medication",
      operation: "create_from_extraction",
      requestDigestSource: { extractionId: id, input },
      execute: () =>
        this.extraction.createMedicationFromExtraction(profileId, id, input, {
          userId: req.auth!.userId,
          actorRole,
          correlationId: req.correlationId,
        }),
    });
    return result;
  }
}
