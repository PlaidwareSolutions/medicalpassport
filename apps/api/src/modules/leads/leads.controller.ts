import { Body, Controller, Post, Req } from "@nestjs/common";
import { createLeadSchema } from "@medpass/validation";
import { ERROR_CODES } from "@medpass/domain";
import { env } from "../../common/env";
import { ApiProblem } from "../../common/errors";
import { Public } from "../../common/auth.guard";
import { RateLimit } from "../../common/rate-limit.guard";
import { verifyTurnstile } from "../../common/turnstile";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { LeadsService } from "./leads.service";

/**
 * Public professional lead capture (OD-LP-2, marketing /for-clinics/). Same
 * verified public-endpoint shape as the OTP request: `@Public()` +
 * `@RateLimit` (app-level limiter, NOT a Cloudflare zone rule — the Free-plan
 * slot is spent) + optional Turnstile + strict schema validation + ApiProblem.
 * Never accepts patient/health data (schema is `.strict()`).
 */
@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @RateLimit({ name: "lead_submit", limit: 5, windowSeconds: 3600 })
  @Post("public/leads")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(createLeadSchema, body);

    // Lead-form Turnstile (separate widget on the marketing domain). Falls
    // back to skipping when unset — the optional-vendor pattern used app-wide.
    if (!(await verifyTurnstile(env().LEAD_TURNSTILE_SECRET_KEY, input.turnstileToken, req.ip))) {
      throw new ApiProblem(ERROR_CODES.TURNSTILE_FAILED, "Verification failed. Please try again.", 400);
    }

    return this.leads.create(input, "website-for-clinics");
  }
}
