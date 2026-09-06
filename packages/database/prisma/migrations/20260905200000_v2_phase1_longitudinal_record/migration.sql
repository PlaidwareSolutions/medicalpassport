-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('clinic', 'hospital', 'laboratory', 'pharmacy', 'diagnostic_centre', 'other');

-- CreateEnum
CREATE TYPE "EncounterKind" AS ENUM ('outpatient', 'inpatient', 'emergency', 'teleconsult', 'pharmacy', 'lab_visit', 'home');

-- CreateEnum
CREATE TYPE "HealthEventKind" AS ENUM ('prescription', 'medicine_started', 'medicine_changed', 'medicine_stopped', 'medicine_paused', 'medicine_resumed', 'medicine_completed', 'dose_taken', 'dose_missed', 'adherence_summary', 'test_result', 'imaging_report', 'measurement', 'doctor_visit', 'hospital_admission', 'discharge', 'document', 'clinical_note', 'allergy_recorded', 'condition_recorded', 'immunization', 'procedure', 'dispense', 'reconciliation', 'abdm_record_linked', 'share_created', 'caregiver_action', 'profile_updated');

-- CreateEnum
CREATE TYPE "HealthEventActorType" AS ENUM ('patient', 'caregiver', 'provider', 'system');

-- CreateEnum
CREATE TYPE "ConditionClinicalStatus" AS ENUM ('active', 'remission', 'resolved', 'inactive', 'unknown');

-- CreateEnum
CREATE TYPE "AllergyCategory" AS ENUM ('medication', 'food', 'environment', 'biologic', 'other');

-- CreateEnum
CREATE TYPE "AllergyCriticality" AS ENUM ('low', 'high', 'unable_to_assess');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('a_pos', 'a_neg', 'b_pos', 'b_neg', 'ab_pos', 'ab_neg', 'o_pos', 'o_neg', 'unknown');

-- AlterTable
ALTER TABLE "blood_pressure_readings" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "checkup_records" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "glucose_readings" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "medical_reports" ADD COLUMN     "encounter_id" UUID,
ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "medication_instructions" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "patient_allergies" ADD COLUMN     "category" "AllergyCategory",
ADD COLUMN     "code" TEXT,
ADD COLUMN     "code_system" TEXT,
ADD COLUMN     "criticality" "AllergyCriticality",
ADD COLUMN     "onset_date" DATE,
ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "patient_conditions" ADD COLUMN     "abatement_date" DATE,
ADD COLUMN     "clinical_status" "ConditionClinicalStatus",
ADD COLUMN     "code" TEXT,
ADD COLUMN     "code_system" TEXT,
ADD COLUMN     "diagnosed_by_practitioner_id" UUID,
ADD COLUMN     "encounter_id" UUID,
ADD COLUMN     "onset_date" DATE,
ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "severity" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "patient_medications" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "patient_profiles" ADD COLUMN     "blood_group" "BloodGroup",
ADD COLUMN     "height_cm" DECIMAL(5,1);

-- AlterTable
ALTER TABLE "practitioners" ADD COLUMN     "hpr_id" TEXT,
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "registration_council" TEXT,
ADD COLUMN     "registration_number" TEXT,
ADD COLUMN     "verification" "VerificationState" NOT NULL DEFAULT 'unverified';

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "diagnosis_text" TEXT,
ADD COLUMN     "encounter_id" UUID,
ADD COLUMN     "follow_up_on" DATE,
ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "valid_until" DATE,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "report_values" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- AlterTable
ALTER TABLE "weight_readings" ADD COLUMN     "provenance_source" "RecordSource",
ADD COLUMN     "recorded_via" TEXT,
ADD COLUMN     "source_abdm_txn_id" UUID,
ADD COLUMN     "source_device_id" UUID,
ADD COLUMN     "source_document_id" UUID,
ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_organization_id" UUID,
ADD COLUMN     "source_practitioner_id" UUID,
ADD COLUMN     "verification" "VerificationState",
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_user_id" UUID;

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID,
    "kind" "OrganizationKind" NOT NULL DEFAULT 'other',
    "display_name" TEXT NOT NULL,
    "address_text" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone_ciphertext" TEXT,
    "hfr_id" TEXT,
    "verification" "VerificationState" NOT NULL DEFAULT 'unverified',
    "recorded_by_user_id" UUID,
    "merged_into_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "EncounterKind" NOT NULL DEFAULT 'outpatient',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "organization_id" UUID,
    "practitioner_id" UUID,
    "reason_text" TEXT,
    "diagnosis_text" TEXT,
    "discharge_summary_document_id" UUID,
    "notes" TEXT,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "source_document_id" UUID,
    "source_extraction_id" UUID,
    "source_device_id" UUID,
    "source_abdm_txn_id" UUID,
    "source_organization_id" UUID,
    "source_practitioner_id" UUID,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_events" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "occurred_at_local" TEXT,
    "kind" "HealthEventKind" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "encounter_id" UUID,
    "actor_user_id" UUID,
    "actorType" "HealthEventActorType" NOT NULL DEFAULT 'patient',
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "immunizations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "vaccine_text" TEXT NOT NULL,
    "vaccine_code_system" TEXT,
    "vaccine_code" TEXT,
    "dose_number" SMALLINT,
    "administered_on" DATE NOT NULL,
    "organization_id" UUID,
    "lot_number" TEXT,
    "document_id" UUID,
    "notes" TEXT,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "source_document_id" UUID,
    "source_extraction_id" UUID,
    "source_device_id" UUID,
    "source_abdm_txn_id" UUID,
    "source_organization_id" UUID,
    "source_practitioner_id" UUID,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "immunizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "procedure_text" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "performed_on" DATE NOT NULL,
    "organization_id" UUID,
    "practitioner_id" UUID,
    "encounter_id" UUID,
    "notes" TEXT,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "source_document_id" UUID,
    "source_extraction_id" UUID,
    "source_device_id" UUID,
    "source_abdm_txn_id" UUID,
    "source_organization_id" UUID,
    "source_practitioner_id" UUID,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_history" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "condition_text" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "notes" TEXT,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "source_document_id" UUID,
    "source_extraction_id" UUID,
    "source_device_id" UUID,
    "source_abdm_txn_id" UUID,
    "source_organization_id" UUID,
    "source_practitioner_id" UUID,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "family_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone_ciphertext" TEXT NOT NULL,
    "priority" SMALLINT NOT NULL DEFAULT 1,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_hfr_id_key" ON "organizations"("hfr_id");

-- CreateIndex
CREATE INDEX "organizations_patient_profile_id_deleted_at_idx" ON "organizations"("patient_profile_id", "deleted_at");

-- CreateIndex
CREATE INDEX "organizations_display_name_idx" ON "organizations"("display_name");

-- CreateIndex
CREATE INDEX "encounters_patient_profile_id_started_at_idx" ON "encounters"("patient_profile_id", "started_at");

-- CreateIndex
CREATE INDEX "health_events_patient_profile_id_occurred_at_idx" ON "health_events"("patient_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "health_events_patient_profile_id_kind_occurred_at_idx" ON "health_events"("patient_profile_id", "kind", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "health_events_entity_type_entity_id_kind_occurred_at_key" ON "health_events"("entity_type", "entity_id", "kind", "occurred_at");

-- CreateIndex
CREATE INDEX "immunizations_patient_profile_id_administered_on_idx" ON "immunizations"("patient_profile_id", "administered_on");

-- CreateIndex
CREATE INDEX "procedures_patient_profile_id_performed_on_idx" ON "procedures"("patient_profile_id", "performed_on");

-- CreateIndex
CREATE INDEX "family_history_patient_profile_id_idx" ON "family_history"("patient_profile_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_patient_profile_id_priority_idx" ON "emergency_contacts"("patient_profile_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_hpr_id_key" ON "practitioners"("hpr_id");

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reports" ADD CONSTRAINT "medical_reports_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "practitioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

