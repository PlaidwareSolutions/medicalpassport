import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { createTestDueSchema, updateTestDueSchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { IdempotencyService } from "../../common/idempotency.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { parseWith } from "../../common/zod";
import { TestDueService } from "./test-due.service";

/**
 * `profiles/current/test-due[/:id]` (docs_v2/05 §12): the schedules behind
 * `test_due` reminders. Same scope pair as diagnostics — `view_tests` to
 * read, `upload_tests` to plan — because planning the next HbA1c is part
 * of managing test results, not of managing medicines.
 */
@Controller("profiles/current/test-due")
export class TestDueController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly testDue: TestDueService,
  ) {}

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver") {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId };
  }

  @Get()
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    return this.testDue.list(profileId);
  }

  @Get(":id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_tests");
    return this.testDue.byId(profileId, id);
  }

  @Post()
  async create(@Body() body: unknown, @Headers("idempotency-key") idempotencyKey: string | undefined, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    const input = parseWith(createTestDueSchema, body);
    const { result } = await this.idempotency.run({
      key: idempotencyKey,
      userId: req.auth!.userId,
      profileId,
      entity: "test_due_schedule",
      operation: "create",
      requestDigestSource: input,
      execute: () => this.testDue.create(profileId, input, this.actor(req, actorRole)),
    });
    return result;
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    const input = parseWith(updateTestDueSchema, body);
    return this.testDue.update(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "upload_tests");
    await this.testDue.softDelete(profileId, id, this.actor(req, actorRole));
  }
}
