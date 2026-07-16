import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { CORRELATION_HEADER, newCorrelationId } from "@medpass/observability";
import type { ApiRequest } from "./http";

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: ApiRequest, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_HEADER);
    // Accept only well-formed IDs from the edge; otherwise mint one.
    const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : newCorrelationId();
    req.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    // PHI responses must never be publicly cached (docs/26). Public routes
    // that are cacheable override this explicitly.
    res.setHeader("cache-control", "private, no-store");
    next();
  }
}
