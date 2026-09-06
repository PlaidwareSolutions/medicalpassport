import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCatalog } from "./adapter.js";
import { catalogAdapterContract } from "./contract.js";
import { parseSampleCatalog, SampleCatalogAdapter, SAMPLE_CATALOG_RELATIVE_PATH, SAMPLE_CATALOG_SOURCE_NAME } from "./sample-catalog.js";

/**
 * docs_v2/06 P2-6: the sample adapter passes the contract every vendor adapter must pass.
 * Real data stays blocked on OD-3; the sample file is the only feed until then.
 */
const file = parseSampleCatalog(JSON.parse(readFileSync(join(__dirname, "..", "..", SAMPLE_CATALOG_RELATIVE_PATH), "utf8")));

describe("SampleCatalogAdapter", () => {
  const checks = catalogAdapterContract({
    create: () => new SampleCatalogAdapter(file, 7),
    // Development-sized bounds; Gate 1's real bounds (≥ 200 / ≥ 50) need OD-3.
    minimumProducts: 30,
    minimumCombinations: 8,
  });

  it.each(checks.map((c) => [c.name, c] as const))("contract: %s", async (_name, check) => {
    await expect(check.run()).resolves.toBeUndefined();
  });

  it("is unmistakably sample data", () => {
    const adapter = new SampleCatalogAdapter(file);
    expect(file.sample).toBe(true);
    expect(file.notice).toMatch(/SAMPLE DATA/);
    expect(file.notice).toMatch(/OD-3/);
    expect(adapter.sourceName).toBe(SAMPLE_CATALOG_SOURCE_NAME);
    expect(adapter.description).toMatch(/SAMPLE/);
    expect(file.products.every((p) => (p.regulatoryRef ?? "SAMPLE-REF").startsWith("SAMPLE-REF"))).toBe(true);
  });

  it("pages through every product with an opaque cursor", async () => {
    const adapter = new SampleCatalogAdapter(file, 7);
    const first = await adapter.listProducts(null);
    expect(first.rows).toHaveLength(7);
    expect(first.nextCursor).not.toBeNull();
    const all = await collectCatalog(adapter);
    expect(all).toHaveLength(file.products.length);
    await expect(adapter.listProducts("not-a-number")).rejects.toThrow(/bad cursor/);
  });

  it("maps a row to the canonical product shape the database holds", () => {
    const adapter = new SampleCatalogAdapter(file);
    const fdc = adapter.mapToCanonical(file.products.find((p) => p.key === "smp-0004")!);
    expect(fdc).toMatchObject({
      productKey: "smp-0004",
      brandName: "Glimestar M2",
      manufacturer: "Mankind",
      genericName: "Glimepiride + Metformin",
      dosageForm: "tablet",
      route: "oral",
      isCombination: true,
      releaseType: "unspecified",
      status: "active",
    });
    expect(fdc.ingredients).toEqual([
      { name: "Glimepiride", strengthValue: 2, strengthUnit: "mg" },
      { name: "Metformin", strengthValue: 500, strengthUnit: "mg" },
    ]);
    const single = adapter.mapToCanonical(file.products.find((p) => p.key === "smp-0002")!);
    expect(single.isCombination).toBe(false);
    expect(single.releaseType).toBe("sustained");
  });

  it("refuses a file that is not marked as sample data", () => {
    expect(() => parseSampleCatalog({ ...file, sample: false })).toThrow(/sample: true/);
    expect(() => parseSampleCatalog({ ...file, notice: "licensed feed" })).toThrow(/sample data/);
    expect(() => parseSampleCatalog({ ...file, products: [{ key: "x" }] })).toThrow(/lacks brand/);
  });
});
