-- AlterTable: children V1 parent/lawful-guardian attestation (additive, nullable)
ALTER TABLE "patient_profiles" ADD COLUMN     "guardian_attested_by_user_id" UUID;
ALTER TABLE "patient_profiles" ADD COLUMN     "guardian_attested_at" TIMESTAMPTZ(6);
ALTER TABLE "patient_profiles" ADD COLUMN     "guardian_attestation_version" TEXT;
