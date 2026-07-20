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

  @RateLimit({ name: "document_upload", limit: 20, windowSeconds: 3600 })
  @Post("profiles/current/documents/authorize-upload")
  async authorizeUpload(@Body() body: unknown, @Req() req: ApiRequest) {
    // Uploading a prescription photo is part of adding a medication.
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    const input = parseWith(authorizeUploadSchema, body);
    return this.documents.authorizeUpload(profileId, input, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Post("documents/:id/complete")
  async complete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    return this.documents.completeUpload(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("documents/:id/download-url")
  async downloadUrl(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "view_medications");
    return this.documents.downloadUrl(profileId, id, {
      userId: req.auth!.userId,
      actorType: actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("profiles/current/documents")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_medications");
    return { items: await this.documents.list(profileId) };
  }
}
