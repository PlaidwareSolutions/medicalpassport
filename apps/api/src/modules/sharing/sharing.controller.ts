import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { createShareSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { sha256Hex } from "../../common/crypto";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { SharingService } from "./sharing.service";
import { ALL_SECTIONS, VisitSummaryService } from "./visit-summary.service";
import { VisitSummaryPdfService } from "./visit-summary-pdf.service";

@Controller()
export class SharingController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly sharing: SharingService,
    private readonly visitSummary: VisitSummaryService,
    private readonly pdf: VisitSummaryPdfService,
  ) {}

  /** Screen 28: doctor-visit mode — always the full summary, patient's own authenticated view. */
  @Get("profiles/current/visit-summary")
  async visitSummaryEndpoint(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return this.visitSummary.build(profileId, ALL_SECTIONS);
  }

  /** Same data as above, rendered as a printable PDF (docs/22 Stage 7 follow-up). */
  @Get("profiles/current/visit-summary/pdf")
  async visitSummaryPdf(@Req() req: ApiRequest, @Res() res: Response) {
    const { profileId } = await this.access.require(req, "share_records");
    const summary = await this.visitSummary.build(profileId, ALL_SECTIONS);
    const buffer = await this.pdf.render(summary);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", 'attachment; filename="medication-summary.pdf"');
    res.setHeader("cache-control", "private, no-store");
    res.send(buffer);
  }

  @Post("profiles/current/shares")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    const input = parseWith(createShareSchema, body);
    return this.sharing.create(profileId, req.auth!.userId, input, req.correlationId);
  }

  @Get("profiles/current/shares")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return { items: await this.sharing.list(profileId) };
  }

  @Get("shares/:id/accesses")
  async accesses(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return { items: await this.sharing.accessLog(profileId, id) };
  }

  @Post("shares/:id/revoke")
  async revoke(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return this.sharing.revoke(profileId, id, req.auth!.userId, req.correlationId);
  }

  /**
   * Public share access (docs/14, docs/26): no auth, never cached
   * (CorrelationMiddleware already sets private/no-store globally), token
   * never appears in a URL path segment that would be logged with PHI —
   * the token itself is opaque and carries no PHI, so this is safe.
   */
  @Public()
  @Get("public/shares/:token")
  async publicAccess(@Param("token") token: string, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader("cache-control", "private, no-store");
    return this.sharing.accessByToken(token, req.ip ? sha256Hex(req.ip) : undefined);
  }

  /** Same public, no-auth access path as above, rendered as a downloadable PDF. */
  @Public()
  @Get("public/shares/:token/pdf")
  async publicAccessPdf(@Param("token") token: string, @Req() req: ApiRequest, @Res() res: Response) {
    const summary = await this.sharing.accessByToken(token, req.ip ? sha256Hex(req.ip) : undefined);
    const buffer = await this.pdf.render(summary);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", 'attachment; filename="medication-summary.pdf"');
    res.setHeader("cache-control", "private, no-store");
    res.send(buffer);
  }
}
