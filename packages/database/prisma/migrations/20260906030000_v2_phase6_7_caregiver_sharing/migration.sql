-- V2 Phase 6/7 (docs_v2/06 P6-3..P6-5, P7-1..P7-3): caregiver notification
-- kinds carry who triggered them (never a recipient); share access events
-- record what was read (summary / snapshot / one document page).

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "triggered_by_user_id" UUID;

-- AlterTable
ALTER TABLE "share_access_events" ADD COLUMN     "resource" TEXT,
ADD COLUMN     "document_id" UUID,
ADD COLUMN     "page_number" INTEGER;
