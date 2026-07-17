-- CreateEnum
CREATE TYPE "NotificationChannelKind" AS ENUM ('in_app', 'web_push', 'sms', 'whatsapp', 'email', 'caregiver');

-- CreateEnum
CREATE TYPE "NotificationChannelStatus" AS ENUM ('active', 'paused', 'failed', 'revoked');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('dose_reminder', 'refill', 'completion', 'missed_dose', 'safety_finding', 'caregiver_escalation', 'system');

-- CreateEnum
CREATE TYPE "NotificationPrivacyMode" AS ENUM ('generic', 'full_name');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'dispatching', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "NotificationAttemptStatus" AS ENUM ('queued', 'sent', 'delivered', 'failed', 'retried', 'acknowledged', 'snoozed', 'ignored', 'escalated');

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannelKind" NOT NULL DEFAULT 'web_push',
    "address_ciphertext" TEXT NOT NULL,
    "endpoint_digest" TEXT NOT NULL,
    "status" "NotificationChannelStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL DEFAULT 'dose_reminder',
    "scheduled_dose_id" UUID,
    "privacy_mode" "NotificationPrivacyMode" NOT NULL DEFAULT 'generic',
    "dedupe_key" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_attempts" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "notification_channel_id" UUID,
    "channel" "NotificationChannelKind" NOT NULL,
    "status" "NotificationAttemptStatus" NOT NULL DEFAULT 'queued',
    "error_digest" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "privacy_mode" "NotificationPrivacyMode" NOT NULL DEFAULT 'generic',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_channels_endpoint_digest_key" ON "notification_channels"("endpoint_digest");

-- CreateIndex
CREATE INDEX "notification_channels_user_id_idx" ON "notification_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_attempts_notification_id_idx" ON "notification_attempts"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_patient_profile_id_key" ON "notification_preferences"("patient_profile_id");

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_scheduled_dose_id_fkey" FOREIGN KEY ("scheduled_dose_id") REFERENCES "scheduled_doses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_channel_id_fkey" FOREIGN KEY ("notification_channel_id") REFERENCES "notification_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
