import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export const INTERNAL_TOKEN_HEADER = "x-abdm-internal-token";
/** Injection token for the expected shared secret (from `ABDM_INTERNAL_TOKEN`). */
export const INTERNAL_TOKEN = "ABDM_INTERNAL_TOKEN";

/**
 * `/internal/*` is reachable only by `apps/api` over private networking and must carry the shared
 * token (docs_v2/08 §4 "internal, mTLS-or-token-authenticated /internal/* API"). Constant-time
 * comparison; a missing or wrong token is a bare 401 with no detail.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(@Inject(INTERNAL_TOKEN) private readonly expectedToken: string) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.header(INTERNAL_TOKEN_HEADER);
    if (!presented) throw new UnauthorizedException();
    const a = Buffer.from(presented);
    const b = Buffer.from(this.expectedToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
