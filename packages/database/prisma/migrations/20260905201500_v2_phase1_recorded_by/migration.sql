-- AlterTable
ALTER TABLE "medical_reports" ADD COLUMN     "recorded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "medication_instructions" ADD COLUMN     "recorded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "patient_medications" ADD COLUMN     "recorded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "recorded_by_user_id" UUID;

