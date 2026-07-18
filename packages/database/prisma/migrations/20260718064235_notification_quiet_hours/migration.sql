-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quiet_hours_end" TEXT NOT NULL DEFAULT '07:00',
ADD COLUMN     "quiet_hours_start" TEXT NOT NULL DEFAULT '22:00';
