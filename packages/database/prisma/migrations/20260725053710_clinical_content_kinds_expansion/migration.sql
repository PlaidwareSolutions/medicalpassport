-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClinicalContentKind" ADD VALUE 'storage';
ALTER TYPE "ClinicalContentKind" ADD VALUE 'warning_symptoms';
ALTER TYPE "ClinicalContentKind" ADD VALUE 'food_alcohol';
ALTER TYPE "ClinicalContentKind" ADD VALUE 'missed_dose';

-- AlterTable
ALTER TABLE "clinical_content_versions" ADD COLUMN     "low_confidence" BOOLEAN NOT NULL DEFAULT false;
