import { EventEmitter } from "node:events";
import { of, throwError } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { LoggingInterceptor } from "./logging.interceptor";

/**
 * Regression test for a real bug: the interceptor used to read
 * `res.statusCode` inside RxJS `finalize`, which runs before the exception
 * filter sets the status on error paths — so every 4xx/5xx was logged as
 * whatever Express's default (200) was. Logging on the `finish` event fixes
 * this because it only fires once the status is actually final.
 */
describe("LoggingInterceptor", () => {
  function makeContext(res: { statusCode: number } & EventEmitter) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET", route: { path: "/v1/test" } }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  }

  it("logs the status code that is current when the response finishes, not when the handler completes", () => {
    const logger = { info: jest.fn() };
    const interceptor = new LoggingInterceptor(logger as never);
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });

    const handler: CallHandler = { handle: () => of({ ok: true }) };
    interceptor.intercept(makeContext(res), handler).subscribe();

    // Simulate the exception filter setting the real status just before the
    // response is actually sent — this happens strictly after the handler's
    // observable resolves/errors, and before `finish` fires.
    res.statusCode = 404;
    res.emit("finish");

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }), "request");
  });

  it("still logs correctly on the success path", () => {
    const logger = { info: jest.fn() };
    const interceptor = new LoggingInterceptor(logger as never);
    const res = Object.assign(new EventEmitter(), { statusCode: 201 });

    const handler: CallHandler = { handle: () => of({ ok: true }) };
    interceptor.intercept(makeContext(res), handler).subscribe();
    res.emit("finish");

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ status: 201 }), "request");
  });

  it("does not blow up when the handler observable errors before finish", () => {
    const logger = { info: jest.fn() };
    const interceptor = new LoggingInterceptor(logger as never);
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });

    const handler: CallHandler = { handle: () => throwError(() => new Error("boom")) };
    interceptor.intercept(makeContext(res), handler).subscribe({ error: () => {} });

    res.statusCode = 500;
    res.emit("finish");

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }), "request");
  });
});
