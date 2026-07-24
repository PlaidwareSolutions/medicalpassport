-- CreateEnum
CREATE TYPE "ClinicalContentKind" AS ENUM ('education');

-- CreateEnum
CREATE TYPE "ContentReviewStatus" AS ENUM ('draft', 'approved', 'rejected', 'retired');

-- CreateEnum
CREATE TYPE "ContentSourceKind" AS ENUM ('daily_med', 'manual');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminDuty" ADD VALUE 'content_write';
ALTER TYPE "AdminDuty" ADD VALUE 'content_approve';

-- AlterEnum
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'content_enrichment';

-- CreateTable
CREATE TABLE "clinical_content" (
    "id" UUID NOT NULL,
    "kind" "ClinicalContentKind" NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clinical_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_content_versions" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "source_kind" "ContentSourceKind" NOT NULL,
    "source_citation" TEXT NOT NULL,
    "source_url" TEXT,
    "review_status" "ContentReviewStatus" NOT NULL DEFAULT 'draft',
    "proposed_by_admin_user_id" UUID,
    "decided_by_admin_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "is_solo_approval" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_content_current_version_id_key" ON "clinical_content"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_content_kind_ingredient_id_key" ON "clinical_content"("kind", "ingredient_id");

-- CreateIndex
CREATE INDEX "clinical_content_versions_content_id_review_status_idx" ON "clinical_content_versions"("content_id", "review_status");

-- AddForeignKey
ALTER TABLE "clinical_content" ADD CONSTRAINT "clinical_content_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "medication_ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content" ADD CONSTRAINT "clinical_content_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "clinical_content_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content_versions" ADD CONSTRAINT "clinical_content_versions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "clinical_content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content_versions" ADD CONSTRAINT "clinical_content_versions_proposed_by_admin_user_id_fkey" FOREIGN KEY ("proposed_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content_versions" ADD CONSTRAINT "clinical_content_versions_decided_by_admin_user_id_fkey" FOREIGN KEY ("decided_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
