import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@medpass/domain";

/** HttpException carrying a stable machine-readable code (docs/14 errors). */
export class ApiProblem extends HttpException {
  constructor(
    readonly code: ErrorCode,
    title: string,
    status: number,
    readonly fieldErrors?: Array<{ path: string; message: string }>,
  ) {
    super({ title }, status);
  }
}
