import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { SampleCatalogAdapter, type SampleCatalogFile } from "@medpass/medication-terminology";
import { importMedicationCatalog } from "./import-medication-catalog";

/**
 * Catalog import skeleton (docs_v2/06 P2-6) against Postgres: idempotent on the same version,
 * updates in place on a newer one, deprecates what left the feed. Uses its own source name so
 * it never touches the dev seed or a real import. Skipped without DATABASE_URL, like the
 * other DB-backed cron specs.
 */
describe.skipIf(!process.env.DATABASE_URL)("importMedicationCatalog", () => {
  let prisma: PrismaClient;
  const suffix = randomUUID().slice(0, 8);

  /** A tiny feed with unique names, so a parallel run of the suite cannot collide. */
  function feed(version: string, extra: Partial<SampleCatalogFile> = {}): SampleCatalogFile {
    return {
      sample: true,
      notice: "SAMPLE DATA for the import test",
      version,
      products: [
        {
          key: `t-${suffix}-1`,
          brand: `TestBrand ${suffix}`,
          aliases: ["TB"],
          manufacturer: `TestMaker ${suffix}`,
          generic: `Testamol ${suffix}`,
          form: "tablet",
          route: "oral",
          strengthLabel: "500 mg",
          ingredients: [{ name: `Testamol ${suffix}`, strength: 500, unit: "mg" }],
          classes: [`TestClass ${suffix}`],
        },
        {
          key: `t-${suffix}-2`,
          brand: `TestCombo ${suffix}`,
          manufacturer: `TestMaker ${suffix}`,
          generic: `Testamol ${suffix} + Testformin ${suffix}`,
          form: "tablet",
          route: "oral",
          strengthLabel: "500 mg / 850 mg",
          ingredients: [
            { name: `Testamol ${suffix}`, strength: 500, unit: "mg" },
            { name: `Testformin ${suffix}`, strength: 850, unit: "mg" },
          ],
          classes: [`TestClass ${suffix}`],
        },
      ],
      ...extra,
    };
  }

  class TestAdapter extends SampleCatalogAdapter {
    override readonly sourceName = `TEST-CATALOG-${suffix}`;
  }

  beforeAll(() => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    const products = await prisma.medicationProduct.findMany({ where: { sourceName: `TEST-CATALOG-${suffix}` }, select: { id: true } });
    const ids = products.map((p) => p.id);
    await prisma.productClassification.deleteMany({ where: { productId: { in: ids } } });
    await prisma.medicationProductIngredient.deleteMany({ where: { productId: { in: ids } } });
    await prisma.medicationProduct.deleteMany({ where: { id: { in: ids } } });
    await prisma.medicationBrand.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.medicationIngredient.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.therapeuticClass.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.manufacturer.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it("creates products with brand, ingredients, classes and the catalog version, then re-runs without duplicating", async () => {
    const adapter = new TestAdapter(feed("v1"));
    const first = await importMedicationCatalog(prisma, adapter);
    expect(first).toMatchObject({ sourceName: `TEST-CATALOG-${suffix}`, catalogVersion: "v1", seen: 2, created: 2, updated: 0, deprecated: 0 });

    const rows = await prisma.medicationProduct.findMany({
      where: { sourceName: adapter.sourceName },
      include: { brand: { include: { manufacturer: true } }, ingredients: { include: { ingredient: true } }, classifications: { include: { class: true } }, dosageForm: true },
      orderBy: { catalogProductKey: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.catalogVersion === "v1" && r.sourceVersion === "v1" && r.status === "active")).toBe(true);
    const combo = rows.find((r) => r.catalogProductKey === `t-${suffix}-2`)!;
    expect(combo.isCombination).toBe(true);
    expect(combo.ingredients.map((i) => `${i.ingredient.name}:${i.strengthValue}`).sort()).toEqual([`Testamol ${suffix}:500`, `Testformin ${suffix}:850`]);
    expect(combo.brand?.manufacturer?.name).toBe(`TestMaker ${suffix}`);
    expect(combo.classifications[0]?.class.name).toBe(`TestClass ${suffix}`);
    expect(rows[0]?.brand?.aliases).toEqual(["TB"]);

    const again = await importMedicationCatalog(prisma, adapter);
    expect(again).toMatchObject({ created: 0, updated: 2, deprecated: 0 });
    expect(await prisma.medicationProduct.count({ where: { sourceName: adapter.sourceName } })).toBe(2);
    expect(await prisma.medicationBrand.count({ where: { name: { contains: suffix } } })).toBe(2);
  });

  it("a newer version updates in place and deprecates what left the feed — never deletes", async () => {
    const v2 = feed("v2");
    v2.products = [{ ...v2.products[0]!, strengthLabel: "650 mg", ingredients: [{ name: `Testamol ${suffix}`, strength: 650, unit: "mg" }] }];
    const summary = await importMedicationCatalog(prisma, new TestAdapter(v2));
    expect(summary).toMatchObject({ catalogVersion: "v2", seen: 1, created: 0, updated: 1, deprecated: 1 });

    const rows = await prisma.medicationProduct.findMany({
      where: { sourceName: `TEST-CATALOG-${suffix}` },
      include: { ingredients: true },
      orderBy: { catalogProductKey: "asc" },
    });
    expect(rows).toHaveLength(2);
    const kept = rows.find((r) => r.catalogProductKey === `t-${suffix}-1`)!;
    expect(kept.strengthLabel).toBe("650 mg");
    expect(kept.catalogVersion).toBe("v2");
    expect(Number(kept.ingredients[0]?.strengthValue)).toBe(650);
    const gone = rows.find((r) => r.catalogProductKey === `t-${suffix}-2`)!;
    expect(gone.status).toBe("deprecated");
    expect(gone.catalogVersion).toBe("v2");
  });

  it("refuses a feed with a duplicated key rather than guessing which row wins", async () => {
    const dup = feed("v3");
    dup.products = [dup.products[0]!, { ...dup.products[0]! }];
    await expect(importMedicationCatalog(prisma, new TestAdapter(dup))).rejects.toThrow(/duplicate productKey/);
  });
});
