-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "sound_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN "vibration_enabled" BOOLEAN NOT NULL DEFAULT true;
