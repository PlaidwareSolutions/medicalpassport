/**
 * `pnpm --filter @medpass/api openapi:check` — the CI diff gate (ADR-V2-013).
 *
 * Regenerates the document to a temporary file and compares it with the
 * committed `apps/api/openapi.json`. Exit 1 with a unified diff when they
 * differ: the fix is to run `openapi:generate` and commit the result (which
 * is precisely the reviewable contract change the gate exists to surface).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createTwoFilesPatch } from "diff";
import { generate, PINNED_DOCUMENT_PATH } from "./generate";

export async function check(): Promise<{ ok: boolean; diff?: string }> {
  const dir = mkdtempSync(join(tmpdir(), "medpass-openapi-"));
  try {
    const candidatePath = join(dir, "openapi.json");
    await generate(candidatePath);
    const committed = existsSync(PINNED_DOCUMENT_PATH) ? readFileSync(PINNED_DOCUMENT_PATH, "utf8") : "";
    const candidate = readFileSync(candidatePath, "utf8");
    if (committed === candidate) return { ok: true };
    const label = relative(process.cwd(), PINNED_DOCUMENT_PATH).split("\\").join("/");
    return { ok: false, diff: createTwoFilesPatch(`a/${label}`, `b/${label}`, committed, candidate, "committed", "generated") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  check()
    .then(({ ok, diff }) => {
      if (ok) {
        console.log("openapi: apps/api/openapi.json is up to date");
        process.exit(0);
      }
      console.error(diff);
      console.error("\nopenapi: apps/api/openapi.json is out of date. Run `pnpm --filter @medpass/api openapi:generate` and commit the result.");
      process.exit(1);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
