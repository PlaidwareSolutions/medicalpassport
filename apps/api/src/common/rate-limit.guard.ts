import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "./errors";
import { RateLimitService } from "./rate-limit.service";
import type { ApiRequest } from "./http";

export const RATE_LIMIT_KEY = "rate_limit";

export interface RateLimitOptions {
  /** Distinguishes this endpoint's budget from every other rate-limited route sharing the same IP. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Applies a per-IP request budget to a route (docs/14 "per-endpoint budgets"). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Global guard (registered alongside `AuthGuard`) that only acts on routes
 * carrying `@RateLimit()` metadata — everything else passes through
 * unaffected. Runs regardless of authentication status, since several
 * rate-limited flows (OTP request/verify, public share access) are
 * intentionally `@Public()` (docs/26: these need protection precisely
 * because they have no session to gate them).
 *
 * Scoped by client IP only, not by account — the OTP flows already have a
 * tighter, phone-scoped limit of their own (`AuthService`); this is the
 * IP-scoped layer docs/26 says must exist independently, since Cloudflare's
 * per-IP rate limiting isn't provisioned in this sandbox (`req.ip` reads the
 * trusted `CF-Connecting-IP`/`X-Forwarded-For` value once it is, via
 * `app.set("trust proxy", true)` in main.ts — no code change needed then).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = req.ip ?? "unknown";

    const { allowed, retryAfterSeconds } = await this.rateLimit.checkAndIncrement(
      `${options.name}:${ip}`,
      options.limit,
      options.windowSeconds,
    );
    if (!allowed) {
      res.setHeader("retry-after", String(retryAfterSeconds));
      throw new ApiProblem(ERROR_CODES.RATE_LIMITED, "Too many requests. Please try again later.", 429);
    }
    return true;
  }
}
