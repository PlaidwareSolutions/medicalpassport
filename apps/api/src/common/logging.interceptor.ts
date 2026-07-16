import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { Observable, tap } from "rxjs";
import type { Logger } from "@medpass/observability";
import type { ApiRequest } from "./http";

/**
 * Structured request logging: method, route pattern (not the raw URL — path
 * params are opaque IDs but route patterns are safer), status, duration,
 * correlation ID. Never bodies, never query strings (docs/12 §log hygiene).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap({
        finalize: () => {
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
        },
      }),
    );
  }
}
