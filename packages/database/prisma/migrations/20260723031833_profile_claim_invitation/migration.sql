-- AlterTable
ALTER TABLE "patient_profiles" ADD COLUMN     "claim_invite_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "claim_invited_at" TIMESTAMPTZ(6),
ADD COLUMN     "claim_invited_phone_digest" TEXT,
ADD COLUMN     "dependent_relationship" TEXT;
