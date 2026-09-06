import { EventEmitter } from "node:events";
import type { ArgumentsHost } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "./errors";
import { ProblemDetailsFilter } from "./problem.filter";

/**
 * Guard rejections (401/403/429) happen before LoggingInterceptor runs, so
 * the filter must log them itself — otherwise `step_up_required` and every
 * other guard outcome is invisible in the request log (ticket 0.20 finding).
 */
describe("ProblemDetailsFilter request logging", () => {
  function makeHost(req: Record<string, unknown>) {
    const emitter = new EventEmitter();
    const res = Object.assign(emitter, {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      setHeader() {
        return res;
      },
      json(body: unknown) {
        res.body = body;
        emitter.emit("finish");
        return res;
      },
    });
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
    return { host, res };
  }

  it("logs a guard rejection when the interceptor never attached", () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const filter = new ProblemDetailsFilter(logger as never);
    const { host, res } = makeHost({ method: "POST", route: { path: "/v1/profiles/current/shares" }, correlationId: "c1" });

    filter.catch(new ApiProblem(ERROR_CODES.STEP_UP_REQUIRED, "Please confirm", 403), host);

    expect(res.statusCode).toBe(403);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", route: "/v1/profiles/current/shares", status: 403, code: "step_up_required", correlationId: "c1" }),
      "request",
    );
  });

  it("does not double-log when the interceptor already owns the request line", () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const filter = new ProblemDetailsFilter(logger as never);
    const { host } = makeHost({ method: "GET", route: { path: "/v1/x" }, requestLogAttached: true });

    filter.catch(new ApiProblem(ERROR_CODES.NOT_FOUND, "Nope", 404), host);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
