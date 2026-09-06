/**
 * Medication catalog import (docs_v2/06 P2-6). Idempotent: re-running on the same feed
 * version changes nothing; a newer version updates rows in place and stamps `catalogVersion`.
 *
 * REAL DATA IS BLOCKED ON OD-3. Until a licensed Indian catalog is contracted, the only
 * adapter is `SampleCatalogAdapter` over `packages/medication-terminology/data/
 * sample-catalog.v1.json` — clearly marked sample rows for development and the contract
 * tests. Gate 1 (docs_v2/10 §4: ≥ 200 products, ≥ 50 FDCs, ≥ 98 % resolution) cannot be
 * signed off on this data. When OD-3 lands, the vendor adapter registers here and this file
 * does not otherwise change.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSampleCatalog, SampleCatalogAdapter, SAMPLE_CATALOG_RELATIVE_PATH } from "@medpass/medication-terminology";
import { importMedicationCatalog } from "../lib/import-medication-catalog";
import { runJob } from "../lib/run-job";

function sampleAdapter(): SampleCatalogAdapter {
  const packageRoot = dirname(require.resolve("@medpass/medication-terminology/package.json"));
  const json = JSON.parse(readFileSync(join(packageRoot, SAMPLE_CATALOG_RELATIVE_PATH), "utf8")) as unknown;
  return new SampleCatalogAdapter(parseSampleCatalog(json));
}

runJob("import-medication-catalog", async ({ prisma, log }) => {
  const adapter = sampleAdapter();
  log.warn({ source: adapter.sourceName }, adapter.description);
  const summary = await importMedicationCatalog(prisma, adapter);
  return { ...summary };
});
