import type { z, ZodTypeAny } from "zod";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "./errors";

/** Parses input with a shared Zod schema, converting failures to 400 problems. */
export function parseWith<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiProblem(
      ERROR_CODES.VALIDATION_FAILED,
      "Some fields are invalid",
      400,
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data as z.output<S>;
}
