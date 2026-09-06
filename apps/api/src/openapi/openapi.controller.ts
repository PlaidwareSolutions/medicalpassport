import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERROR_CODES } from "@medpass/domain";
import { Public } from "../common/auth.guard";
import { ApiProblem } from "../common/errors";

/** `apps/api/openapi.json` — resolves from both `src/openapi` and `dist/openapi`. */
const PINNED_DOCUMENT_PATH = resolve(__dirname, "../../openapi.json");

let cached: { text: string; etag: string } | undefined;

function loadPinnedDocument(): { text: string; etag: string } {
  if (cached) return cached;
  if (!existsSync(PINNED_DOCUMENT_PATH)) {
    throw new ApiProblem(ERROR_CODES.NOT_FOUND, "OpenAPI document is not available", 404);
  }
  const text = readFileSync(PINNED_DOCUMENT_PATH, "utf8");
  // Weak validator derived from the content itself, so a redeploy with the
  // same spec keeps clients' caches valid.
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  cached = { text, etag: `W/"${(hash >>> 0).toString(16)}-${text.length}"` };
  return cached;
}

/**
 * Serves the pinned OpenAPI 3.1 document (docs_v2/05 §14, ADR-V2-013). It is
 * the committed file, byte for byte — never regenerated at request time, so
 * what clients read is exactly what CI diffed. Public and PHI-free.
 */
@Controller("meta")
export class OpenApiController {
  @Public()
  @Get("openapi.json")
  document(@Res() res: Response): void {
    const { text, etag } = loadPinnedDocument();
    // The correlation middleware defaults every response to `private,
    // no-store`; the contract carries no PHI and may be cached briefly.
    res.setHeader("cache-control", "public, max-age=300");
    res.setHeader("etag", etag);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.status(200).send(text);
  }
}
