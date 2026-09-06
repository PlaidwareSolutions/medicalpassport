/**
 * `pnpm --filter @medpass/api openapi:generate`
 *
 * Writes the pinned OpenAPI document to `apps/api/openapi.json`
 * deterministically (stable key order, 2-space indent, trailing newline).
 * Boots the app without listening and never touches the database; the CI
 * environment defaults are applied for any variable that is unset.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PINNED_DOCUMENT_PATH = resolve(__dirname, "../../openapi.json");

export async function generate(outputPath = PINNED_DOCUMENT_PATH): Promise<{ path: string; operations: number }> {
  const { buildOpenApiDocument, serializeDocument } = await import("./build-document");
  const document = await buildOpenApiDocument();
  writeFileSync(outputPath, serializeDocument(document), "utf8");
  const paths = document.paths as Record<string, Record<string, unknown>>;
  const operations = Object.values(paths).reduce((n, item) => n + Object.keys(item).length, 0);
  return { path: outputPath, operations };
}

if (require.main === module) {
  generate()
    .then(({ path, operations }) => {
      console.log(`openapi: wrote ${operations} operations to ${path}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
