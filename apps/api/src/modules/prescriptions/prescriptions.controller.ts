import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import {
  createPrescriptionSchema,
  linkMedicationSchema,
  prescriptionItemSchema,
  startMedicationFromItemSchema,
  updatePrescriptionItemSchema,
} from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { PrescriptionsService } from "./prescriptions.service";

/**
 * Prescription records (docs/07 screen 43). Gated on view_profile/edit_profile
 * — the same scopes as allergies/conditions/glucose readings, since this is a
 * patient-owned record that may have no medications attached at all, not a
 * medication mutation. A caregiver with only `view_medications` can read
 * these but not create or delete them.
 */
@Controller()
export class PrescriptionsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly prescriptions: PrescriptionsService,
  ) {}

  @Get("profiles/current/prescriptions")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.prescriptions.list(profileId) };
  }

  @Post("profiles/current/prescriptions")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    rejectClientProvenance(body);
    const input = parseWith(createPrescriptionSchema, body);
    return this.prescriptions.create(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  @Get("prescriptions/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const prescription = await this.prescriptions.byId(profileId, id);
    if (!prescription) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription not found", 404);
    return prescription;
  }

  @Post("prescriptions/:id/medications")
  async linkMedication(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(linkMedicationSchema, body);
    return this.prescriptions.linkMedication(profileId, id, input.medicationId, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  /**
   * Line items as written on the prescription (docs_v2/05 §4). Reading them
   * is `view_profile`, like the prescription itself; starting one as a
   * medicine is `add_medications`, because that is what it actually does.
   */
  @Get("prescriptions/:id/items")
  async listItems(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.prescriptions.listItems(profileId, id) };
  }

  @Post("prescriptions/:id/items")
  async addItem(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    rejectClientProvenance(body);
    const input = parseWith(prescriptionItemSchema, body);
    return this.prescriptions.addItem(profileId, id, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  @Patch("prescription-items/:itemId")
  async updateItem(@Param("itemId") itemId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    rejectClientProvenance(body);
    const input = parseWith(updatePrescriptionItemSchema, body);
    return this.prescriptions.updateItem(profileId, itemId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  @Delete("prescription-items/:itemId")
  @HttpCode(204)
  async deleteItem(@Param("itemId") itemId: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    await this.prescriptions.deleteItem(profileId, itemId, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  /** Turns a prescribed line into one of the patient's current medicines. */
  @Post("prescription-items/:itemId/start-medication")
  async startMedication(@Param("itemId") itemId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "add_medications");
    const input = parseWith(startMedicationFromItemSchema, body);
    return this.prescriptions.startMedicationFromItem(profileId, itemId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }

  @Delete("prescriptions/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    await this.prescriptions.softDelete(profileId, id, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
      recordedVia: recordedViaFor(req),
    });
  }
}
