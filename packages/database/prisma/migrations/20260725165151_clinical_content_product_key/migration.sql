-- DropForeignKey
ALTER TABLE "clinical_content" DROP CONSTRAINT "clinical_content_ingredient_id_fkey";

-- AlterTable
ALTER TABLE "clinical_content" ADD COLUMN     "product_id" UUID,
ALTER COLUMN "ingredient_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "clinical_content_kind_product_id_key" ON "clinical_content"("kind", "product_id");

-- AddForeignKey
ALTER TABLE "clinical_content" ADD CONSTRAINT "clinical_content_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "medication_ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content" ADD CONSTRAINT "clinical_content_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "medication_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: exactly one of ingredient_id/product_id is ever set —
-- enforced at the DB level as cheap insurance alongside the two
-- independent call sites (worker, admin propose) that must uphold it.
ALTER TABLE "clinical_content" ADD CONSTRAINT "clinical_content_exactly_one_key" CHECK (("ingredient_id" IS NULL) <> ("product_id" IS NULL));
