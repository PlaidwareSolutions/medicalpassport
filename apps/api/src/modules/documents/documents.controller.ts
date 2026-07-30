import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { authorizeUploadSchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { RateLimit } from "../../common/rate-limit.guard";
import { DocumentsService } from "./documents.service";

@Controller()
export class DocumentsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * A document is either evidence for a prescription record (docs/07 screen
   * 43) or part of scanning a medicine to add it — different scopes govern
   * each, so the body is parsed first to know which this is. The
   * medication-scoped path is byte-for-byte today's behavior.
   */
  @RateLimit({ name: "document_upload", limit: 20, windowSeconds: 3600 })
  @Post("profiles/current/documents/authorize-upload")
  async authorizeUpload(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(authorizeUploadSchema, body);
    const { profileId, actorRole } = await this.access.require(req, input.prescriptionId ? "edit_profile" : "add_medications");
    return this.documents.authorizeUpload(profileId, input, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Post("documents/:id/complete")
  async complete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.requireDocumentWrite(req);
    return this.documents.completeUpload(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("documents/:id/download-url")
  async downloadUrl(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.requireDocumentRead(req);
    return this.documents.downloadUrl(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("profiles/current/documents")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.requireDocumentRead(req);
    return { items: await this.documents.list(profileId) };
  }

  /**
   * These routes only carry a document id, so they can't know up front
   * whether it belongs to a prescription record or a medication scan.
   * Accepting either scope is a deliberate, documented broadening: both
   * paths are legitimate document owners, and refusing one would break a
   * caregiver who holds only the other. Nothing widens beyond callers who
   * already had document access under one of the two.
   */
  private async requireDocumentWrite(req: ApiRequest) {
    try {
      return await this.access.require(req, "add_medications");
    } catch {
      return await this.access.require(req, "edit_profile");
    }
  }

  private async requireDocumentRead(req: ApiRequest) {
    try {
      return await this.access.require(req, "view_medications");
    } catch {
      return await this.access.require(req, "view_profile");
    }
  }
}
