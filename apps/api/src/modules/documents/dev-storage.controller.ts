import { Controller, Get, Param, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/auth.guard";
import { DocumentsService } from "./documents.service";

/**
 * Local-disk stand-in for a real presigned R2 URL (docs/24 ADR-12). These
 * routes are intentionally unauthenticated — the token itself is the
 * authorization, exactly like a real presigned S3/R2 URL: scoped to one
 * object, one operation, and a short expiry, verified via HMAC signature.
 * This module (and only this module) would not exist against real R2 —
 * the client would PUT/GET directly to Cloudflare instead.
 */
@Controller("dev-storage")
export class DevStorageController {
  constructor(private readonly documents: DocumentsService) {}

  @Public()
  @Put(":token")
  async upload(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    await this.documents.handleDevUpload(token, req);
    res.status(200).json({ ok: true });
  }

  @Public()
  @Get(":token")
  async download(@Param("token") token: string, @Res() res: Response) {
    await this.documents.handleDevDownload(token, res);
  }
}
