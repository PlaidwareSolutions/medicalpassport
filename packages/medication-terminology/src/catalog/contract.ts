/**
 * Contract tests every `MedicationCatalogAdapter` must pass (docs_v2/06 P2-6 "contract tests
 * against a vendor sample"). Framework-agnostic checks that throw on failure, so the same
 * list runs under vitest here and in a vendor evaluation once OD-3 unblocks real data.
 */
import { collectCatalog, type CanonicalMedicationProduct, type MedicationCatalogAdapter } from "./adapter.js";

export interface CatalogContractCheck {
  name: string;
  run(): Promise<void>;
}

export interface CatalogContractOptions<Row> {
  create(): MedicationCatalogAdapter<Row> | Promise<MedicationCatalogAdapter<Row>>;
  /** Lower bounds the feed is expected to meet (Gate 1 asks ≥ 200 / ≥ 50 for real data). */
  minimumProducts?: number;
  minimumCombinations?: number;
}

const STRENGTH_UNITS = new Set(["mg", "g", "mcg", "µg", "iu", "ml", "%", "mg/ml", "mcg/ml", "mg/5ml", "mcg/puff", "mcg/dose", "mg/dose", "iu/ml", "meq", "mmol"]);

export function catalogAdapterContract<Row>(options: CatalogContractOptions<Row>): CatalogContractCheck[] {
  const minimumProducts = options.minimumProducts ?? 1;
  const minimumCombinations = options.minimumCombinations ?? 0;

  return [
    {
      name: "identifies its source and version",
      async run() {
        const adapter = await options.create();
        assert(nonEmpty(adapter.sourceName), "sourceName must be a non-empty string");
        assert(/^[A-Za-z0-9._-]+$/.test(adapter.sourceName), "sourceName must be a stable token (letters, digits, . _ -)");
        assert(nonEmpty(adapter.description), "description must be a non-empty string");
        const version = await adapter.version();
        assert(nonEmpty(version), "version() must return a non-empty string");
        assert(version === (await adapter.version()), "version() must be stable across calls");
      },
    },
    {
      name: "pages to completion with unique, stable product keys",
      async run() {
        const adapter = await options.create();
        const rows = await collectCatalog(adapter);
        assert(rows.length >= minimumProducts, `expected at least ${minimumProducts} products, got ${rows.length}`);
        const keys = new Set<string>();
        for (const row of rows) {
          assert(nonEmpty(row.productKey), "every product needs a productKey");
          assert(!keys.has(row.productKey), `duplicate productKey ${row.productKey}`);
          keys.add(row.productKey);
        }
        const again = await collectCatalog(await options.create());
        assert(
          JSON.stringify(again.map((r) => r.productKey)) === JSON.stringify(rows.map((r) => r.productKey)),
          "a second pass must yield the same keys in the same order (idempotent import depends on it)",
        );
      },
    },
    {
      name: "maps every row to a valid canonical product",
      async run() {
        const adapter = await options.create();
        for (const row of await collectCatalog(adapter)) assertCanonical(row);
      },
    },
    {
      name: "marks fixed-dose combinations honestly (ingredients ≥ 2 ⇔ isCombination)",
      async run() {
        const adapter = await options.create();
        const rows = await collectCatalog(adapter);
        let combinations = 0;
        for (const row of rows) {
          const multi = row.ingredients.length >= 2;
          assert(row.isCombination === multi, `${row.productKey}: isCombination=${row.isCombination} but ${row.ingredients.length} ingredients`);
          if (multi) combinations += 1;
        }
        assert(combinations >= minimumCombinations, `expected at least ${minimumCombinations} FDCs, got ${combinations}`);
      },
    },
    {
      name: "mapToCanonical is pure: the same row maps to the same product and the row is untouched",
      async run() {
        const adapter = await options.create();
        const page = await adapter.listProducts(null);
        const row = page.rows[0];
        assert(row !== undefined, "the first page must not be empty");
        const before = JSON.stringify(row);
        const a = JSON.stringify(adapter.mapToCanonical(row));
        const b = JSON.stringify(adapter.mapToCanonical(row));
        assert(a === b, "mapToCanonical must be deterministic");
        assert(JSON.stringify(row) === before, "mapToCanonical must not mutate its input row");
      },
    },
  ];
}

export function assertCanonical(row: CanonicalMedicationProduct): void {
  const at = row.productKey || "<no key>";
  assert(nonEmpty(row.genericName), `${at}: genericName is required`);
  assert(row.brandName === null || nonEmpty(row.brandName), `${at}: brandName must be null or non-empty`);
  assert(Array.isArray(row.brandAliases), `${at}: brandAliases must be an array`);
  assert(["active", "deprecated"].includes(row.status), `${at}: status must be active|deprecated`);
  assert(
    ["immediate", "sustained", "extended", "controlled", "unspecified"].includes(row.releaseType),
    `${at}: releaseType out of range`,
  );
  assert(row.ingredients.length >= 1, `${at}: at least one ingredient`);
  for (const ing of row.ingredients) {
    assert(nonEmpty(ing.name), `${at}: ingredient name is required`);
    if (ing.strengthValue !== null) {
      assert(Number.isFinite(ing.strengthValue) && ing.strengthValue > 0, `${at}: strengthValue must be a positive number`);
      assert(ing.strengthUnit !== null && STRENGTH_UNITS.has(ing.strengthUnit.toLowerCase()), `${at}: unknown strength unit ${ing.strengthUnit}`);
    }
  }
  assert(row.therapeuticClasses.every(nonEmpty), `${at}: therapeutic classes must be non-empty strings`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`catalog adapter contract: ${message}`);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
