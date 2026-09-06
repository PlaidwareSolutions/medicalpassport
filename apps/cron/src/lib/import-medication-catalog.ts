/**
 * Catalog import (docs_v2/06 P2-6): upserts whatever a `MedicationCatalogAdapter` yields into
 * the medication tables, idempotently, keyed on `(sourceName, catalogProductKey)` and stamped
 * with the adapter's `version()` as `catalogVersion`.
 *
 * Running it twice on the same feed changes nothing but `updatedAt`; running it on a newer
 * feed updates rows in place (same key) and never deletes: a product that left the feed is
 * marked `deprecated` (when asked to) because patient medications still point at it.
 *
 * Real data is blocked on OD-3. The only adapter today is the sample one, so this job is the
 * skeleton Gate 1 will run through once a licensed feed exists — nothing here is specific to
 * the sample.
 */
import type { PrismaClient } from "@medpass/database";
import { collectCatalog, type CanonicalMedicationProduct, type MedicationCatalogAdapter } from "@medpass/medication-terminology";

export interface CatalogImportSummary {
  sourceName: string;
  catalogVersion: string;
  seen: number;
  created: number;
  updated: number;
  deprecated: number;
}

export interface CatalogImportOptions {
  /** Mark products of this source that the feed no longer lists as `deprecated`. Default true. */
  deprecateMissing?: boolean;
}

export async function importMedicationCatalog(
  prisma: PrismaClient,
  adapter: MedicationCatalogAdapter,
  options: CatalogImportOptions = {},
): Promise<CatalogImportSummary> {
  const catalogVersion = await adapter.version();
  const products = await collectCatalog(adapter);
  const summary: CatalogImportSummary = { sourceName: adapter.sourceName, catalogVersion, seen: products.length, created: 0, updated: 0, deprecated: 0 };

  const seenKeys = new Set<string>();
  for (const product of products) {
    if (seenKeys.has(product.productKey)) throw new Error(`${adapter.sourceName}: duplicate productKey ${product.productKey} in feed`);
    seenKeys.add(product.productKey);
    const outcome = await upsertProduct(prisma, adapter.sourceName, catalogVersion, product);
    summary[outcome] += 1;
  }

  if (options.deprecateMissing !== false) {
    const stale = await prisma.medicationProduct.updateMany({
      where: { sourceName: adapter.sourceName, status: "active", catalogProductKey: { notIn: [...seenKeys] } },
      data: { status: "deprecated", catalogVersion },
    });
    summary.deprecated = stale.count;
  }
  return summary;
}

async function upsertProduct(
  prisma: PrismaClient,
  sourceName: string,
  catalogVersion: string,
  product: CanonicalMedicationProduct,
): Promise<"created" | "updated"> {
  return prisma.$transaction(async (tx) => {
    const manufacturer = product.manufacturer
      ? await tx.manufacturer.upsert({ where: { name: product.manufacturer }, update: {}, create: { name: product.manufacturer } })
      : null;
    const form = product.dosageForm
      ? await tx.dosageForm.upsert({ where: { name: product.dosageForm }, update: {}, create: { name: product.dosageForm } })
      : null;
    const route = product.route
      ? await tx.administrationRoute.upsert({ where: { name: product.route }, update: {}, create: { name: product.route } })
      : null;

    let brandId: string | null = null;
    if (product.brandName) {
      const existing = await tx.medicationBrand.findFirst({ where: { name: product.brandName, manufacturerId: manufacturer?.id ?? null } });
      const aliases = [...new Set([...(existing?.aliases ?? []), ...product.brandAliases])];
      const brand = existing
        ? await tx.medicationBrand.update({ where: { id: existing.id }, data: { aliases } })
        : await tx.medicationBrand.create({ data: { name: product.brandName, aliases, manufacturerId: manufacturer?.id ?? null } });
      brandId = brand.id;
    }

    const data = {
      brandId,
      genericName: product.genericName,
      dosageFormId: form?.id ?? null,
      routeId: route?.id ?? null,
      releaseType: product.releaseType,
      isCombination: product.isCombination,
      strengthLabel: product.strengthLabel,
      regulatoryRef: product.regulatoryRef,
      sourceName,
      sourceVersion: catalogVersion,
      catalogProductKey: product.productKey,
      catalogVersion,
      status: product.status,
    } as const;

    const existing = await tx.medicationProduct.findUnique({
      where: { sourceName_catalogProductKey: { sourceName, catalogProductKey: product.productKey } },
      select: { id: true },
    });
    const row = existing
      ? await tx.medicationProduct.update({ where: { id: existing.id }, data })
      : await tx.medicationProduct.create({ data });

    // Ingredients: the feed is authoritative for this product's composition.
    const keepIngredientIds: string[] = [];
    for (const ing of product.ingredients) {
      const ingredient = await tx.medicationIngredient.upsert({ where: { name: ing.name }, update: {}, create: { name: ing.name } });
      keepIngredientIds.push(ingredient.id);
      await tx.medicationProductIngredient.upsert({
        where: { productId_ingredientId: { productId: row.id, ingredientId: ingredient.id } },
        update: { strengthValue: ing.strengthValue, strengthUnit: ing.strengthUnit },
        create: { productId: row.id, ingredientId: ingredient.id, strengthValue: ing.strengthValue, strengthUnit: ing.strengthUnit },
      });
    }
    await tx.medicationProductIngredient.deleteMany({ where: { productId: row.id, ingredientId: { notIn: keepIngredientIds } } });

    // Classifications from this source; classifications another source added are left alone.
    const keepClassIds: string[] = [];
    for (const name of product.therapeuticClasses) {
      const klass = await tx.therapeuticClass.upsert({ where: { name }, update: {}, create: { name } });
      keepClassIds.push(klass.id);
      await tx.productClassification.upsert({
        where: { productId_classId: { productId: row.id, classId: klass.id } },
        update: { source: sourceName },
        create: { productId: row.id, classId: klass.id, source: sourceName },
      });
    }
    await tx.productClassification.deleteMany({ where: { productId: row.id, source: sourceName, classId: { notIn: keepClassIds } } });

    return existing ? "updated" : "created";
  });
}
