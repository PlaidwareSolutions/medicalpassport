import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response, Request } from "express";
import { ERROR_CODES, type ProblemDetails } from "@medpass/domain";
import type { Logger } from "@medpass/observability";
import { ApiProblem } from "./errors";

/** Prisma's code for a value that cannot be read as the column's type (e.g. a malformed UUID). */
function isMalformedIdError(exception: unknown): boolean {
  const code = (exception as { code?: unknown } | null)?.code;
  return code === "P2023";
}

/**
 * Converts every error into an RFC 7807 problem+json body with a stable code
 * and correlation ID — never PHI, never stack traces (docs/14).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string; requestLogAttached?: boolean; auth?: { userId: string } }>();
    const started = Date.now();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = "Something went wrong";
    let code: ProblemDetails["code"] = ERROR_CODES.INTERNAL;
    let errors: ProblemDetails["errors"];

    if (exception instanceof ApiProblem) {
      status = exception.getStatus();
      title = (exception.getResponse() as { title: string }).title;
      code = exception.code;
      errors = exception.fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      title = typeof body === "string" ? body : ((body as { message?: string }).message ?? exception.message);
      code = status === 404 ? ERROR_CODES.NOT_FOUND : status === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.INTERNAL;
    } else if (isMalformedIdError(exception)) {
      // Prisma raises P2023 ("inconsistent column data") when a path segment
      // that must be a UUID is not one. A URL a person typed or an old link
      // is not a server fault: /medicines/not-a-real-id answered 500 before
      // this (2026-09-07 UI review). It reads as "not found", which is what
      // it is, and leaks nothing about what the id would have matched.
      status = HttpStatus.NOT_FOUND;
      title = "Not found";
      code = ERROR_CODES.NOT_FOUND;
    } else {
      // Unexpected error: log internally (message only), return an opaque body.
      this.logger.error(
        { correlationId: req.correlationId, err: exception instanceof Error ? exception.message : "unknown" },
        "unhandled exception",
      );
    }

    const problem: ProblemDetails = {
      type: "about:blank",
      title,
      status,
      code,
      correlationId: req.correlationId,
      ...(errors ? { errors } : {}),
    };

    // Guards run before interceptors, so a rejection raised by a guard
    // (unauthenticated, step_up_required, rate_limited, …) never reached
    // LoggingInterceptor — those responses were invisible in the request log.
    // Same line shape as the interceptor, plus the problem code.
    if (!req.requestLogAttached) {
      res.once("finish", () => {
        this.logger.info(
          {
            method: req.method,
            route: req.route?.path ?? "unmatched",
            status: res.statusCode,
            durationMs: Date.now() - started,
            correlationId: req.correlationId,
            userId: req.auth?.userId,
            code,
          },
          "request",
        );
      });
    }

    res.status(status).setHeader("content-type", "application/problem+json").json(problem);
  }
}
