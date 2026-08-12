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
    const cfg = env();
    const secret = cfg.LEAD_TURNSTILE_SECRET_KEY;

    // Fail-closed (Session 11): in a real deployment (production/staging) the
    // lead form MUST be Turnstile-protected. A missing secret there is a
    // misconfiguration, not a reason to silently accept bot traffic — reject
    // clearly rather than falling open. Local dev / tests may run without it
    // (or with Cloudflare test keys).
    const turnstileRequired = cfg.NODE_ENV === "production" || cfg.NODE_ENV === "staging";
    if (turnstileRequired && !secret) {
      throw new ApiProblem(ERROR_CODES.INTERNAL, "Lead form is temporarily unavailable.", 503);
    }

    const expectedHostnames = cfg.LEAD_TURNSTILE_HOSTNAMES?.split(",").map((h) => h.trim()).filter(Boolean);
    if (!(await verifyTurnstile(secret, input.turnstileToken, req.ip, expectedHostnames))) {
      throw new ApiProblem(ERROR_CODES.TURNSTILE_FAILED, "Verification failed. Please try again.", 400);
    }

    return this.leads.create(input, "website-for-clinics");
  }
}
