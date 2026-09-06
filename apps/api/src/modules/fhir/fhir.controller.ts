import { Controller, Get, Header, Query, Req } from "@nestjs/common";
import { fhirExportQuerySchema, fhirPatientSummaryQuerySchema } from "@medpass/validation";
import { RequiresStepUp } from "../../common/auth.guard";
import type { ApiRequest } from "../../common/http";
import { ProfileAccessService } from "../../common/profile-access.service";
import { parseWith } from "../../common/zod";
import { FhirExportService } from "./fhir-export.service";

/**
 * FHIR export of the patient's own record (docs_v2/05 §10, docs_v2/08 §2 / §8).
 *
 * Both routes are step-up guarded (ADR-V2-012: exports re-verify the session) and audited, and
 * both are gated on `share_records` — a caregiver may only export what they could share. The
 * response body is the Bundle itself (`application/fhir+json`); validation findings are persisted
 * as `FhirValidationFailure` rows rather than blocking the patient's own export (ADR-V2-001).
 */
@Controller()
export class FhirController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly fhir: FhirExportService,
  ) {}

  @Get("profiles/current/fhir/export")
  @RequiresStepUp()
  @Header("content-type", "application/fhir+json; charset=utf-8")
  async exportBundle(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "share_records");
    const parsed = parseWith(fhirExportQuerySchema, query);
    const result = await this.fhir.exportBundle(profileId, parsed.ig, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId });
    return result.bundle;
  }

  /** Phase 15: Indian Patient Summary — v7.0 only (docs_v2/08 §8). */
  @Get("profiles/current/fhir/ips")
  @RequiresStepUp()
  @Header("content-type", "application/fhir+json; charset=utf-8")
  async patientSummary(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "share_records");
    parseWith(fhirPatientSummaryQuerySchema, query);
    const result = await this.fhir.patientSummary(profileId, { userId: req.auth!.userId, actorRole, correlationId: req.correlationId });
    return result.bundle;
  }
}
