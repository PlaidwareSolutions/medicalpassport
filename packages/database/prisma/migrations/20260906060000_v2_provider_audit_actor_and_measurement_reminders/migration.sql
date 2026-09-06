-- AlterEnum
ALTER TYPE "AuditActorType" ADD VALUE 'provider';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "measurement_reminders_json" JSONB;

