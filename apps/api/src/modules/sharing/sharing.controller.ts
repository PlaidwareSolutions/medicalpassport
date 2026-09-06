import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { ERROR_CODES } from "@medpass/domain";
import { createShareSchema, visitSummaryTextQuerySchema } from "@medpass/validation";
import { Public, RequiresStepUp } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import { RateLimit } from "../../common/rate-limit.guard";
import { sha256Hex } from "../../common/crypto";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { DoctorSnapshotService } from "./doctor-snapshot.service";
import { SharingService } from "./sharing.service";
import { ALL_SECTIONS, VisitSummaryService } from "./visit-summary.service";
import { VisitSummaryPdfService } from "./visit-summary-pdf.service";
import { renderVisitSummaryText } from "./visit-summary-text";

@Controller()
export class SharingController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly sharing: SharingService,
    private readonly visitSummary: VisitSummaryService,
    private readonly doctorSnapshot: DoctorSnapshotService,
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

  /**
   * Plain-text summary for the patient's own WhatsApp app to send (docs/07
   * screen 29 "WhatsApp text summary") — there's no WhatsApp Business API
   * account to send through server-side (OD-10 blocked), so this hands the
   * formatted text to the client, which opens WhatsApp's own share intent.
   * Respects the same selective sections as share creation (all included
   * by default, matching `ALL_SECTIONS`).
   */
  @Get("profiles/current/visit-summary/text")
  async visitSummaryText(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    const sections = parseWith(visitSummaryTextQuerySchema, query);
    const summary = await this.visitSummary.build(profileId, sections);
    return { text: renderVisitSummaryText(summary) };
  }

  /**
   * The Doctor Snapshot (docs_v2/05 §9): the patient's own concise clinician
   * view, always complete. Same scope as the visit summary — this is the
   * data the patient hands to a doctor, not the data they manage.
   */
  @Get("profiles/current/doctor-snapshot")
  async doctorSnapshotEndpoint(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "share_records");
    return this.doctorSnapshot.build(profileId, ALL_SECTIONS);
  }

  @RequiresStepUp()
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
  @RateLimit({ name: "share_access", limit: 30, windowSeconds: 60 })
  @Get("public/shares/:token")
  async publicAccess(@Param("token") token: string, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader("cache-control", "private, no-store");
    return this.sharing.accessByToken(token, req.ip ? sha256Hex(req.ip) : undefined);
  }

  /** Same public, no-auth access path as above, rendered as a downloadable PDF. */
  @Public()
  @RateLimit({ name: "share_access", limit: 30, windowSeconds: 60 })
  @Get("public/shares/:token/pdf")
  async publicAccessPdf(@Param("token") token: string, @Req() req: ApiRequest, @Res() res: Response) {
    const summary = await this.sharing.accessByToken(token, req.ip ? sha256Hex(req.ip) : undefined);
    const buffer = await this.pdf.render(summary);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", 'attachment; filename="medication-summary.pdf"');
    res.setHeader("cache-control", "private, no-store");
    res.send(buffer);
  }

  /** The Doctor Snapshot for a recipient (docs_v2/05 §9): same frozen sections as the summary, same logging, no-store. */
  @Public()
  @RateLimit({ name: "share_access", limit: 30, windowSeconds: 60 })
  @Get("public/shares/:token/snapshot")
  async publicSnapshot(@Param("token") token: string, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader("cache-control", "private, no-store");
    return this.sharing.snapshotByToken(token, req.ip ? sha256Hex(req.ip) : undefined);
  }

  /**
   * One page of a shared document (docs_v2/05 §9, docs_v2/06 P7-3): 302 to
   * a short-lived signed URL, only when the share chose `documents`. Every
   * attempt — including a refused one — lands in the patient-visible access
   * log, and the redirect itself is never cacheable.
   */
  @Public()
  @RateLimit({ name: "share_access", limit: 30, windowSeconds: 60 })
  @Get("public/shares/:token/documents/:documentId/pages/:pageNumber")
  async publicDocumentPage(
    @Param("token") token: string,
    @Param("documentId") documentId: string,
    @Param("pageNumber") pageNumberRaw: string,
    @Req() req: ApiRequest,
    @Res() res: Response,
  ) {
    const pageNumber = Number(pageNumberRaw);
    if (!/^[0-9a-f-]{36}$/i.test(documentId) || !Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This link is no longer available", 404);
    }
    const { url } = await this.sharing.documentPageByToken(token, documentId, pageNumber, req.ip ? sha256Hex(req.ip) : undefined);
    res.setHeader("cache-control", "private, no-store");
    res.redirect(302, url);
  }
}
