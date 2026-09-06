import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from "@nestjs/common";
import {
  authorizeDocumentPagesSchema,
  createDocumentV2Schema,
  documentListQuerySchema,
  updateDocumentV2Schema,
} from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { IdempotencyService } from "../../common/idempotency.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { RateLimit } from "../../common/rate-limit.guard";
import { DocumentsV2Service, type DocumentActor } from "./documents-v2.service";

/**
 * Documents V2 (docs_v2/05 §5). Served under `patient-documents` rather than
 * `documents` so the V1 single-object routes in ../documents keep working
 * unchanged until their V2.5 sunset (docs_v2/05 §15) — same contract shape,
 * a distinct noun, no shadowed route.
 *
 * Scoped on `view_profile`/`edit_profile`: a document is a patient-owned
 * record that may have no medicines in it at all, exactly like a prescription
 * record. Confirming a suggestion into a medicine additionally requires
 * `add_medications` (see ./document-extractions.controller.ts).
 */
@Controller()
export class DocumentsV2Controller {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly documents: DocumentsV2Service,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * `Idempotency-Key` (docs/14) is honoured here because the offline replay
   * (docs_v2/05 §14) resumes an interrupted capture by re-sending this
   * exact create with its clientMutationId as the key: the same document
   * — and its original page authorizations — come back instead of a second
   * document with a second set of presigned URLs. A call without the header
   * behaves as before.
   */
  @RateLimit({ name: "document_upload", limit: 20, windowSeconds: 3600 })
  @Post("profiles/current/patient-documents")
  async create(@Body() body: unknown, @Headers("idempotency-key") idempotencyKey: string | undefined, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    rejectClientProvenance(body);
    const input = parseWith(createDocumentV2Schema, body);
    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "patient_document",
      operation: "create",
      requestDigestSource: body,
      execute: () => this.documents.create(profileId, input, this.actor(req, actorRole)),
    });
    return result;
  }

  @Get("profiles/current/patient-documents")
  async list(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_documents");
    return this.documents.list(profileId, parseWith(documentListQuerySchema, query));
  }

  @Get("patient-documents/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_documents");
    return this.documents.byId(profileId, id);
  }

  @Patch("patient-documents/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    rejectClientProvenance(body);
    const input = parseWith(updateDocumentV2Schema, body);
    return this.documents.update(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete("patient-documents/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    await this.documents.softDelete(profileId, id, this.actor(req, actorRole));
  }

  @RateLimit({ name: "document_upload", limit: 20, windowSeconds: 3600 })
  @Post("patient-documents/:id/pages/authorize-upload")
  async authorizePages(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    const input = parseWith(authorizeDocumentPagesSchema, body);
    return this.documents.authorizePages(profileId, id, input, this.actor(req, actorRole));
  }

  @Post("patient-documents/:id/pages/:pageNumber/complete")
  async completePage(
    @Param("id") id: string,
    @Param("pageNumber", ParseIntPipe) pageNumber: number,
    @Req() req: ApiRequest,
  ) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    return this.documents.completePage(profileId, id, pageNumber, this.actor(req, actorRole));
  }

  /** Re-run classification + extraction; idempotent by page content hash and engine version. */
  @Post("patient-documents/:id/process")
  async process(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_documents");
    return this.documents.process(profileId, id, this.actor(req, actorRole));
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
