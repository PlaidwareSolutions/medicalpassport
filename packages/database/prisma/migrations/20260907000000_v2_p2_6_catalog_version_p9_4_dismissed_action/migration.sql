-- docs_v2/06 P9-4: "not relevant to me" is its own action so Gate 3 can measure false positives.
-- AlterEnum
ALTER TYPE "SafetyFindingActionType" ADD VALUE 'dismissed_not_relevant';

-- docs_v2/06 P2-6: catalog import provenance — the adapter's stable key and the catalog version that wrote the row.
-- AlterTable
ALTER TABLE "medication_products" ADD COLUMN "catalog_product_key" TEXT,
ADD COLUMN "catalog_version" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "medication_products_source_name_catalog_product_key_key" ON "medication_products"("source_name", "catalog_product_key");
