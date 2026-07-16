import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";
import type { Logger } from "@medpass/observability";
import type { ApiRequest } from "./http";

/**
 * Structured request logging: method, route pattern (not the raw URL — path
 * params are opaque IDs but route patterns are safer), status, duration,
 * correlation ID. Never bodies, never query strings (docs/12 §log hygiene).
 *
 * Logs on the response's `finish` event rather than the interceptor's own
 * RxJS `finalize`: on an error path (a thrown ApiProblem, say a 404), our
 * `next.handle()` observable errors and tears down *before* the exception
 * filter runs and actually calls `res.status(...)` — so reading
 * `res.statusCode` at that point always sees Express's default (200),
 * silently mislabeling every 4xx/5xx as a 200 in the logs. `finish` only
 * fires once headers are actually sent, so the status is always final.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    res.on("finish", () => {
      this.logger.info(
        {
          method: req.method,
          route: req.route?.path ?? "unmatched",
          status: res.statusCode,
          durationMs: Date.now() - started,
          correlationId: req.correlationId,
          userId: req.auth?.userId,
        },
        "request",
      );
    });

    return next.handle();
  }
}
