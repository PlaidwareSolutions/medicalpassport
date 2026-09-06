import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import {
  confirmDocumentCandidateSchema,
  materializeExtractionSchema,
  rejectDocumentCandidateSchema,
} from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { IdempotencyService } from "../../common/idempotency.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { DocumentExtractionsService } from "./document-extractions.service";
import type { DocumentActor } from "./documents-v2.service";

/**
 * Reviewing and confirming what was read off a document (docs_v2/05 §5).
 *
 * Reading candidates is `view_profile`; confirming or materializing one is
 * `add_medications`, because that is the scope that actually writes clinical
 * rows — a caregiver who may only read the passport can look at the
 * suggestions but never turn one into a medicine.
 */
@Controller()
export class DocumentExtractionsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly extractions: DocumentExtractionsService,
  ) {}

  @Get("patient-documents/:id/extraction")
  async get(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_documents");
    return this.extractions.get(profileId, id);
  }

  @Post("document-candidates/:id/confirm")
  async confirm(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    rejectClientProvenance(body);
    const input = parseWith(confirmDocumentCandidateSchema, body ?? {});
    return this.extractions.confirm(profileId, id, input, this.actor(req, actorRole));
  }

  @Post("document-candidates/:id/reject")
  async reject(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    parseWith(rejectDocumentCandidateSchema, body ?? {});
    return this.extractions.reject(profileId, id, this.actor(req, actorRole));
  }

  /** Sensitive write: several clinical rows in one go, so it requires Idempotency-Key (docs/14). */
  @Post("document-extractions/:id/materialize")
  async materialize(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: ApiRequest,
  ) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    rejectClientProvenance(body);
    const input = parseWith(materializeExtractionSchema, body);
    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "document_extraction",
      operation: "materialize",
      requestDigestSource: { extractionId: id, input },
      execute: () => this.extractions.materialize(profileId, id, input, this.actor(req, actorRole)),
    });
    return result;
  }

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver"): DocumentActor {
    return {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
      locale: req.auth?.preferredLocale,
    };
  }
}
