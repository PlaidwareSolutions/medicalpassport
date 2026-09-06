/**
 * `SampleCatalogAdapter` (docs_v2/06 P2-6): the stand-in adapter that reads
 * `packages/medication-terminology/data/sample-catalog.v1.json`.
 *
 * SAMPLE DATA. The file holds plausible-looking Indian products written for development and
 * for exercising the import job and its contract tests. It is not a licensed catalog, it has
 * not been clinically reviewed, and nothing in it may be treated as a fact about a real
 * product. Real data is blocked on OD-3 (licensed Indian catalog) and stays so until that
 * decision is taken; Gate 1 (docs_v2/10 §4) is not runnable on this adapter.
 *
 * This package is also bundled into patient-web, so the adapter never touches the
 * filesystem: the caller (the cron job, a test) reads the JSON and passes it to
 * `parseSampleCatalog`.
 */
import type { CanonicalIngredient, CanonicalMedicationProduct, CanonicalReleaseType, CatalogPage, MedicationCatalogAdapter } from "./adapter.js";

export const SAMPLE_CATALOG_SOURCE_NAME = "SAMPLE-CATALOG";
/** Relative to this package's root (`require.resolve("@medpass/medication-terminology/package.json")`). */
export const SAMPLE_CATALOG_RELATIVE_PATH = "data/sample-catalog.v1.json";
export const SAMPLE_CATALOG_NOTICE = "SAMPLE DATA — not a licensed catalog, not clinically reviewed (OD-3)";

export interface SampleCatalogRow {
  key: string;
  brand: string;
  aliases?: string[];
  manufacturer: string;
  generic: string;
  form: string;
  route: string;
  release?: CanonicalReleaseType;
  strengthLabel: string;
  ingredients: Array<{ name: string; strength: number | null; unit: string | null }>;
  classes: string[];
  /** Fake, clearly-labelled reference so the column is exercised; never a real licence number. */
  regulatoryRef?: string;
}

export interface SampleCatalogFile {
  sample: true;
  notice: string;
  version: string;
  products: SampleCatalogRow[];
}

/** Validates the raw JSON; throws with a reason rather than importing a malformed feed. */
export function parseSampleCatalog(json: unknown): SampleCatalogFile {
  if (typeof json !== "object" || json === null) throw new Error("sample catalog: not an object");
  const file = json as Partial<SampleCatalogFile>;
  if (file.sample !== true) throw new Error("sample catalog: refusing a file not marked `sample: true`");
  if (typeof file.version !== "string" || file.version.length === 0) throw new Error("sample catalog: version is required");
  if (typeof file.notice !== "string" || !/sample/i.test(file.notice)) throw new Error("sample catalog: notice must say it is sample data");
  if (!Array.isArray(file.products)) throw new Error("sample catalog: products must be an array");
  file.products.forEach((p, i) => {
    if (typeof p !== "object" || p === null) throw new Error(`sample catalog: product ${i} is not an object`);
    const row = p as Partial<SampleCatalogRow>;
    for (const field of ["key", "brand", "manufacturer", "generic", "form", "route", "strengthLabel"] as const) {
      if (typeof row[field] !== "string" || row[field]!.length === 0) throw new Error(`sample catalog: product ${i} (${row.key ?? "?"}) lacks ${field}`);
    }
    if (!Array.isArray(row.ingredients) || row.ingredients.length === 0) throw new Error(`sample catalog: product ${row.key} has no ingredients`);
    if (!Array.isArray(row.classes)) throw new Error(`sample catalog: product ${row.key} classes must be an array`);
  });
  return file as SampleCatalogFile;
}

export class SampleCatalogAdapter implements MedicationCatalogAdapter<SampleCatalogRow> {
  readonly sourceName: string = SAMPLE_CATALOG_SOURCE_NAME;
  readonly description: string;

  constructor(
    private readonly file: SampleCatalogFile,
    private readonly pageSize = 10,
  ) {
    this.description = `${file.notice} (v${file.version})`;
  }

  async version(): Promise<string> {
    return this.file.version;
  }

  async listProducts(cursor?: string | null): Promise<CatalogPage<SampleCatalogRow>> {
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isInteger(start) || start < 0) throw new Error(`sample catalog: bad cursor ${cursor}`);
    const rows = this.file.products.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { rows, nextCursor: next < this.file.products.length ? String(next) : null };
  }

  mapToCanonical(row: SampleCatalogRow): CanonicalMedicationProduct {
    const ingredients: CanonicalIngredient[] = row.ingredients.map((i) => ({
      name: i.name,
      strengthValue: i.strength,
      strengthUnit: i.unit,
    }));
    return {
      productKey: row.key,
      brandName: row.brand,
      brandAliases: [...(row.aliases ?? [])],
      manufacturer: row.manufacturer,
      genericName: row.generic,
      dosageForm: row.form,
      route: row.route,
      releaseType: row.release ?? "unspecified",
      isCombination: ingredients.length >= 2,
      strengthLabel: row.strengthLabel,
      regulatoryRef: row.regulatoryRef ?? null,
      ingredients,
      therapeuticClasses: [...row.classes],
      status: "active",
    };
  }
}
