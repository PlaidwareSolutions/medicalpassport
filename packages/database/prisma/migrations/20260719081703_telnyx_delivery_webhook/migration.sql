-- AlterTable
ALTER TABLE "notification_attempts" ADD COLUMN     "provider_message_id" TEXT;

-- CreateIndex
CREATE INDEX "notification_attempts_provider_message_id_idx" ON "notification_attempts"("provider_message_id");
