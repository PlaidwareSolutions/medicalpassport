-- AlterEnum
ALTER TYPE "AdminDuty" ADD VALUE 'content_translate';

-- CreateTable
CREATE TABLE "clinical_content_translations" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "review_status" "ContentReviewStatus" NOT NULL DEFAULT 'draft',
    "translated_by_admin_user_id" UUID NOT NULL,
    "decided_by_admin_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "is_solo_approval" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_content_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_content_translations_version_id_locale_key" ON "clinical_content_translations"("version_id", "locale");

-- AddForeignKey
ALTER TABLE "clinical_content_translations" ADD CONSTRAINT "clinical_content_translations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "clinical_content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content_translations" ADD CONSTRAINT "clinical_content_translations_translated_by_admin_user_id_fkey" FOREIGN KEY ("translated_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_content_translations" ADD CONSTRAINT "clinical_content_translations_decided_by_admin_user_id_fkey" FOREIGN KEY ("decided_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
