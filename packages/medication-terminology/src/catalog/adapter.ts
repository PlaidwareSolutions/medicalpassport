/**
 * Licensed catalog adapter interface (docs_v2/06 P2-6, docs_v2/10 §4 Gate 1).
 *
 * An adapter turns one vendor's product feed into `CanonicalMedicationProduct` rows — the
 * shape `medication_products` + brand + ingredients + classes already hold (packages/database
 * seed, `apps/api` catalog). The import job (`apps/cron/src/jobs/import-medication-catalog.ts`)
 * knows nothing about vendors: it pages with `listProducts`, maps with `mapToCanonical`, and
 * upserts on `(sourceName, productKey)` stamping `version()` as `catalogVersion`.
 *
 * REAL DATA IS BLOCKED ON OD-3 (licensed Indian catalog). Until that decision is taken the
 * only adapter is `SampleCatalogAdapter`, whose rows are clearly marked sample data, and
 * Gate 1 (≥ 200 products / ≥ 50 FDCs / ≥ 98 % resolution) cannot be run for real. Every
 * adapter must pass `catalogAdapterContract` (./contract) before the job may select it.
 */

/** Mirrors `MedicationProductIngredient` (strength as a number + unit, e.g. 500 + "mg"). */
export interface CanonicalIngredient {
  name: string;
  strengthValue: number | null;
  strengthUnit: string | null;
}

export type CanonicalReleaseType = "immediate" | "sustained" | "extended" | "controlled" | "unspecified";

/** One product as the database understands it (docs/11, `MedicationProduct` + relations). */
export interface CanonicalMedicationProduct {
  /** Adapter-stable identifier within the source; the upsert key together with `sourceName`. */
  productKey: string;
  brandName: string | null;
  brandAliases: string[];
  manufacturer: string | null;
  /** Generic / INN label; for an FDC the "+"-joined ingredient names. */
  genericName: string;
  dosageForm: string | null;
  route: string | null;
  releaseType: CanonicalReleaseType;
  isCombination: boolean;
  strengthLabel: string | null;
  regulatoryRef: string | null;
  ingredients: CanonicalIngredient[];
  therapeuticClasses: string[];
  status: "active" | "deprecated";
}

export interface CatalogPage<Row> {
  rows: Row[];
  /** Opaque; `null` when this was the last page. */
  nextCursor: string | null;
}

export interface MedicationCatalogAdapter<Row = unknown> {
  /** Recorded as `sourceName` on every row this adapter writes; stable across versions. */
  readonly sourceName: string;
  /** Human-readable licence / provenance line for logs and the admin catalog page. */
  readonly description: string;
  /** The feed's version (a release date, a build id); recorded as `catalogVersion`. */
  version(): Promise<string>;
  /** Pages through the feed. `undefined` / `null` cursor starts from the beginning. */
  listProducts(cursor?: string | null): Promise<CatalogPage<Row>>;
  /** Pure: one vendor row → the canonical shape. Throws on a row it cannot map. */
  mapToCanonical(row: Row): CanonicalMedicationProduct;
}

/** Drains every page of an adapter into canonical rows (small feeds and tests). */
export async function collectCatalog<Row>(adapter: MedicationCatalogAdapter<Row>): Promise<CanonicalMedicationProduct[]> {
  const out: CanonicalMedicationProduct[] = [];
  let cursor: string | null | undefined = null;
  let pages = 0;
  do {
    const page: CatalogPage<Row> = await adapter.listProducts(cursor);
    for (const row of page.rows) out.push(adapter.mapToCanonical(row));
    cursor = page.nextCursor;
    pages += 1;
    if (pages > 100_000) throw new Error(`${adapter.sourceName}: listProducts never returned a null cursor`);
  } while (cursor);
  return out;
}
