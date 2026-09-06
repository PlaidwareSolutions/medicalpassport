-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('unverified', 'patient_confirmed', 'provider_verified', 'source_authenticated');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'step_up';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordSource" ADD VALUE 'user_entered';
ALTER TYPE "RecordSource" ADD VALUE 'caregiver_entered';
ALTER TYPE "RecordSource" ADD VALUE 'ocr_extracted';
ALTER TYPE "RecordSource" ADD VALUE 'clinic_entered';
ALTER TYPE "RecordSource" ADD VALUE 'lab_imported';
ALTER TYPE "RecordSource" ADD VALUE 'pharmacy_entered';
ALTER TYPE "RecordSource" ADD VALUE 'device_recorded';
ALTER TYPE "RecordSource" ADD VALUE 'abdm_imported';
ALTER TYPE "RecordSource" ADD VALUE 'system_derived';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "step_up_verified_at" TIMESTAMPTZ(6);
