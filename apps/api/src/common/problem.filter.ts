import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response, Request } from "express";
import { ERROR_CODES, type ProblemDetails } from "@medpass/domain";
import type { Logger } from "@medpass/observability";
import { ApiProblem } from "./errors";

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
