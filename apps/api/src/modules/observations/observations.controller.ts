import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import {
  measurementDeviceSchema,
  observationBatchSchema,
  observationSchema,
  observationTrendQuerySchema,
  observationsQuerySchema,
  updateMeasurementDeviceSchema,
} from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { ObservationsService } from "./observations.service";

/**
 * Observations (docs_v2/05 §7, ADR-V2-011) — the generic successor to the V1
 * glucose / blood-pressure / weight diaries, which stay live and unchanged.
 * Same access model as those: view_profile to read, edit_profile to write.
 * There is no dedicated scope for patient-self-reported measurements, and
 * inventing one here would silently widen what an existing caregiver grant
 * means.
 */
@Controller()
export class ObservationsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly observations: ObservationsService,
  ) {}

  @Get("profiles/current/observations")
  async list(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_measurements");
    const parsed = parseWith(observationsQuerySchema, query);
    return { items: await this.observations.list(profileId, parsed) };
  }

  @Post("profiles/current/observations")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    rejectClientProvenance(body);
    const input = parseWith(observationSchema, body);
    return this.observations.create(profileId, input, this.actor(req, actorRole));
  }

  /** Device sync: many readings at once, deduped on (concept, measuredAt, deviceId). */
  @Post("profiles/current/observations/batch")
  async createBatch(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    rejectClientProvenance(body);
    const input = parseWith(observationBatchSchema, body);
    return this.observations.createBatch(profileId, input, this.actor(req, actorRole));
  }

  /**
   * Descriptive statistics for one concept — count, average, min/max, a
   * running average and a morning/evening split cut on the patient's own
   * clock. Never a verdict (hazard H-25).
   */
  @Get("profiles/current/trends/observations/:concept")
  async trend(@Param("concept") concept: string, @Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_measurements");
    const parsed = parseWith(observationTrendQuerySchema, query);
    return this.observations.trend(profileId, concept, parsed);
  }

  @Get("observations/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_measurements");
    const row = await this.observations.byId(profileId, id);
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reading not found", 404);
    return row;
  }

  /**
   * Soft-delete, mirroring the V1 diaries: a measurement is a point-in-time
   * event, so a typo is delete + re-add rather than an edit that would
   * rewrite what a doctor already saw.
   */
  @Delete("observations/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    await this.observations.softDelete(profileId, id, this.actor(req, actorRole));
  }

  @Get("profiles/current/measurement-devices")
  async listDevices(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_measurements");
    return { items: await this.observations.listDevices(profileId) };
  }

  @Post("profiles/current/measurement-devices")
  async createDevice(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    rejectClientProvenance(body);
    const input = parseWith(measurementDeviceSchema, body);
    return this.observations.createDevice(profileId, input, this.actor(req, actorRole));
  }

  @Patch("measurement-devices/:id")
  async updateDevice(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    rejectClientProvenance(body);
    const input = parseWith(updateMeasurementDeviceSchema, body);
    return this.observations.updateDevice(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete("measurement-devices/:id")
  @HttpCode(204)
  async deleteDevice(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_measurements");
    await this.observations.deleteDevice(profileId, id, this.actor(req, actorRole));
  }

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver") {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) };
  }
}

/**
 * The observation-concept code table, sibling of `terminology/analytes`:
 * static, identical for every caller, and needed by the unit picker before
 * there is a session. Public for the same reason.
 */
@Controller("terminology")
export class ObservationTerminologyController {
  @Public()
  @Get("observation-concepts")
  concepts() {
    return ObservationsService.conceptTerminology();
  }
}
