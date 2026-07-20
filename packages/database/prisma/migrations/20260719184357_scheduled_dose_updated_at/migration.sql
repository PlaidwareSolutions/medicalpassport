/*
  Warnings:

  - Added the required column `updated_at` to the `scheduled_doses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "scheduled_doses" ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "scheduled_doses" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "scheduled_doses_updated_at_idx" ON "scheduled_doses"("updated_at");
