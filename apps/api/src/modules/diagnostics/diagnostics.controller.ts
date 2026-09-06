import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import {
  addDiagnosticResultSchema,
  correctDiagnosticResultSchema,
  createDiagnosticReportSchema,
  diagnosticReportsQuerySchema,
  diagnosticResultsQuerySchema,
  resultTrendQuerySchema,
  updateDiagnosticReportSchema,
} from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { DiagnosticsService } from "./diagnostics.service";

/**
 * Diagnostics (docs_v2/05 §6) — the V2 successor to `reports`, covering labs
 * and imaging in one shape. Gated on view_profile/edit_profile, exactly like
 * the V1 reports controller it replaces: this is a patient-owned record, not
 * a medication mutation, so a caregiver with only `view_medications` can read
 * it and not write it.
 *
 * The V1 `reports` endpoints stay live and unchanged throughout — they now
 * also write the V2 mirror (ReportsService) — so nothing here is a breaking
 * change for a client that has not migrated.
 */
@Controller()
export class DiagnosticsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  @Get("profiles/current/diagnostic-reports")
  async list(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    const parsed = parseWith(diagnosticReportsQuerySchema, query);
    return { items: await this.diagnostics.list(profileId, parsed) };
  }

  @Post("profiles/current/diagnostic-reports")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    rejectClientProvenance(body);
    const input = parseWith(createDiagnosticReportSchema, body);
    return this.diagnostics.create(profileId, input, this.actor(req, actorRole));
  }

  @Get("diagnostic-reports/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    const report = await this.diagnostics.byId(profileId, id);
    if (!report) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Report not found", 404);
    return report;
  }

  @Patch("diagnostic-reports/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    rejectClientProvenance(body);
    const input = parseWith(updateDiagnosticReportSchema, body);
    return this.diagnostics.update(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete("diagnostic-reports/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    await this.diagnostics.softDelete(profileId, id, this.actor(req, actorRole));
  }

  @Get("diagnostic-reports/:id/results")
  async listResults(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    return { items: await this.diagnostics.listResults(profileId, id) };
  }

  @Post("diagnostic-reports/:id/results")
  async addResult(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    rejectClientProvenance(body);
    const input = parseWith(addDiagnosticResultSchema, body);
    return this.diagnostics.addResult(profileId, id, input, this.actor(req, actorRole));
  }

  /**
   * A correction, not an edit: this writes a new row and points the original
   * at it (docs_v2/04 §6.3). The response is the new row; the original stays
   * readable at its own id forever.
   */
  @Patch("diagnostic-results/:id")
  async correctResult(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    rejectClientProvenance(body);
    const input = parseWith(correctDiagnosticResultSchema, body);
    return this.diagnostics.correctResult(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete("diagnostic-results/:id")
  @HttpCode(204)
  async deleteResult(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    await this.diagnostics.deleteResult(profileId, id, this.actor(req, actorRole));
  }

  /** Every result across every report, filtered by analyte / LOINC / date. */
  @Get("profiles/current/diagnostic-results")
  async searchResults(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    const parsed = parseWith(diagnosticResultsQuerySchema, query);
    return { items: await this.diagnostics.searchResults(profileId, parsed) };
  }

  /**
   * One analyte's series, every point in the canonical unit. Points that
   * cannot be converted come back in `unconvertible[]` rather than being
   * folded into the line (hazard H-35/H-39).
   */
  @Get("profiles/current/trends/results/:analyteKey")
  async resultTrend(@Param("analyteKey") analyteKey: string, @Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    const parsed = parseWith(resultTrendQuerySchema, query);
    return this.diagnostics.resultTrend(profileId, analyteKey, parsed);
  }

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver") {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) };
  }
}

/**
 * The analyte code table (docs_v2/05 §6). A static, PHI-free vocabulary —
 * the same bytes for every caller — so it is public: the unit picker, the
 * OCR mapper and an offline client all need it before there is a session,
 * and gating it would only teach clients to cache it badly.
 */
@Controller("terminology")
export class TerminologyController {
  @Public()
  @Get("analytes")
  analytes() {
    return DiagnosticsService.analyteTerminology();
  }
}
