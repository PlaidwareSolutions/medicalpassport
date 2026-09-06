-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('draft', 'proposed', 'patient_accepted', 'patient_rejected', 'applied', 'withdrawn');

-- CreateEnum
CREATE TYPE "ReconciliationDecision" AS ENUM ('continue', 'stop', 'change', 'add');

-- CreateEnum
CREATE TYPE "DocumentSourceChannel" AS ENUM ('camera', 'gallery', 'file', 'share_target', 'provider_import', 'abdm', 'email_intake');

-- CreateEnum
CREATE TYPE "ClassifiedBy" AS ENUM ('user', 'deterministic', 'model');

-- CreateEnum
CREATE TYPE "DiagnosticReportKind" AS ENUM ('laboratory', 'imaging', 'ecg', 'echo', 'pathology', 'microbiology', 'genetics', 'other');

-- CreateEnum
CREATE TYPE "ImagingModality" AS ENUM ('xray', 'ct', 'mri', 'ultrasound', 'mammography', 'pet', 'nuclear', 'other');

-- CreateEnum
CREATE TYPE "DiagnosticReportStatus" AS ENUM ('registered', 'partial', 'final', 'amended', 'cancelled');

-- CreateEnum
CREATE TYPE "ObservationInterpretation" AS ENUM ('normal', 'high', 'low', 'critical_high', 'critical_low', 'abnormal');

-- CreateEnum
CREATE TYPE "ObservationConcept" AS ENUM ('blood_pressure', 'heart_rate', 'blood_glucose', 'body_weight', 'body_height', 'bmi', 'spo2', 'body_temperature', 'respiratory_rate', 'inr', 'peak_flow', 'pain_score', 'insulin_dose', 'fluid_intake', 'fluid_output', 'waist_circumference', 'steps', 'sleep_hours', 'other');

-- CreateEnum
CREATE TYPE "ObservationContext" AS ENUM ('before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'during_night', 'random', 'fasting', 'resting', 'post_exercise', 'sitting', 'standing', 'lying', 'morning', 'evening');

-- CreateEnum
CREATE TYPE "MeasurementDeviceKind" AS ENUM ('bp_monitor', 'glucometer', 'cgm', 'smart_scale', 'pulse_oximeter', 'thermometer', 'wearable', 'phone_health_platform', 'other');

-- CreateEnum
CREATE TYPE "MeasurementDevicePlatform" AS ENUM ('bluetooth', 'apple_health', 'health_connect', 'vendor_api', 'manual');

-- CreateEnum
CREATE TYPE "AbhaLinkStatus" AS ENUM ('active', 'unlinked', 'suspended');

-- CreateEnum
CREATE TYPE "AbdmConsentStatus" AS ENUM ('requested', 'granted', 'denied', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "AbdmGatewayEnv" AS ENUM ('mock', 'sandbox', 'production');

-- CreateEnum
CREATE TYPE "AbdmImportStatus" AS ENUM ('received', 'validated', 'candidates_created', 'rejected', 'erased');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('patient', 'provider', 'both');

-- CreateEnum
CREATE TYPE "OrganizationMemberRole" AS ENUM ('owner', 'doctor', 'staff', 'pharmacist', 'lab_tech');

-- CreateEnum
CREATE TYPE "ProviderLinkVia" AS ENUM ('qr_onboarding', 'share', 'abdm');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('prescription', 'encounter', 'reconciliation', 'dispense', 'diagnostic_report', 'discharge_transition');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('proposed', 'accepted', 'rejected', 'withdrawn', 'expired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminDuty" ADD VALUE 'abdm_operations';
ALTER TYPE "AdminDuty" ADD VALUE 'fhir_view';
ALTER TYPE "AdminDuty" ADD VALUE 'support_cases';
ALTER TYPE "AdminDuty" ADD VALUE 'privileged_record_access';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BackgroundJobQueue" ADD VALUE 'document_classify';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'document_extract';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'fhir_validate';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'abdm_outbound';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'abdm_inbound_import';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'trend_recompute';
ALTER TYPE "BackgroundJobQueue" ADD VALUE 'notification_dispatch';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CaregiverScope" ADD VALUE 'view_tests';
ALTER TYPE "CaregiverScope" ADD VALUE 'upload_tests';
ALTER TYPE "CaregiverScope" ADD VALUE 'view_measurements';
ALTER TYPE "CaregiverScope" ADD VALUE 'add_measurements';
ALTER TYPE "CaregiverScope" ADD VALUE 'view_documents';
ALTER TYPE "CaregiverScope" ADD VALUE 'upload_documents';
ALTER TYPE "CaregiverScope" ADD VALUE 'manage_caregivers';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentKind" ADD VALUE 'laboratory_report';
ALTER TYPE "DocumentKind" ADD VALUE 'imaging_report';
ALTER TYPE "DocumentKind" ADD VALUE 'consultation_note';
ALTER TYPE "DocumentKind" ADD VALUE 'vaccination_record';
ALTER TYPE "DocumentKind" ADD VALUE 'referral';
ALTER TYPE "DocumentKind" ADD VALUE 'insurance';
ALTER TYPE "DocumentKind" ADD VALUE 'invoice';
ALTER TYPE "DocumentKind" ADD VALUE 'imaging_film';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'measurement_reminder';
ALTER TYPE "NotificationKind" ADD VALUE 'test_due';
ALTER TYPE "NotificationKind" ADD VALUE 'follow_up';
ALTER TYPE "NotificationKind" ADD VALUE 'unusual_measurement';
ALTER TYPE "NotificationKind" ADD VALUE 'new_prescription';
ALTER TYPE "NotificationKind" ADD VALUE 'new_test_result';
ALTER TYPE "NotificationKind" ADD VALUE 'refill_low';

-- AlterTable
ALTER TABLE "background_jobs" ADD COLUMN     "retry_after" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "consents" ADD COLUMN     "collected_via" TEXT,
ADD COLUMN     "notice_version" TEXT,
ADD COLUMN     "purpose_version" INTEGER;

-- AlterTable
ALTER TABLE "medication_instructions" ADD COLUMN     "route_text" TEXT,
ADD COLUMN     "stop_planned_at" DATE,
ADD COLUMN     "strength_label" TEXT;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "channel_frequency_json" JSONB;

-- AlterTable
ALTER TABLE "patient_medications" ADD COLUMN     "prescribing_practitioner_id" UUID,
ADD COLUMN     "reason_condition_id" UUID;

-- AlterTable
ALTER TABLE "share_links" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "recipient_organization_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "user_kind" "UserKind" NOT NULL DEFAULT 'patient';

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL DEFAULT 1,
    "entered_name" TEXT NOT NULL,
    "product_id" UUID,
    "strength_label" TEXT,
    "form_text" TEXT,
    "route_text" TEXT,
    "dose_quantity" DECIMAL(8,3),
    "dose_unit" TEXT,
    "frequency_code" TEXT,
    "pattern" TEXT,
    "food_instruction" TEXT,
    "duration_days" INTEGER,
    "instructions_text" TEXT,
    "started_medication_id" UUID,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_refill_plans" (
    "id" UUID NOT NULL,
    "patient_medication_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "pack_size" DECIMAL(8,2),
    "quantity_on_hand" DECIMAL(8,2),
    "daily_consumption" DECIMAL(8,3),
    "projected_run_out_on" DATE,
    "last_dispense_id" UUID,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_refill_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_dispenses" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "patient_medication_id" UUID,
    "organization_id" UUID,
    "dispensed_at" TIMESTAMPTZ(6) NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "days_supply" INTEGER,
    "lot_number" TEXT,
    "expiry_date" DATE,
    "invoice_document_id" UUID,
    "notes" TEXT,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "medication_dispenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_reconciliations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "encounter_id" UUID,
    "organization_id" UUID,
    "performed_by_user_id" UUID NOT NULL,
    "performed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'draft',
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "applied_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_reconciliation_lines" (
    "id" UUID NOT NULL,
    "reconciliation_id" UUID NOT NULL,
    "patient_medication_id" UUID,
    "prescription_item_id" UUID,
    "decision" "ReconciliationDecision" NOT NULL,
    "proposed_instruction" JSONB,
    "proposed_name" TEXT,
    "reason_text" TEXT,
    "accepted" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'other',
    "title" TEXT,
    "document_date" DATE,
    "prescription_id" UUID,
    "diagnostic_report_id" UUID,
    "encounter_id" UUID,
    "immunization_id" UUID,
    "legacy_prescription_document_id" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending_upload',
    "classification" "DocumentKind",
    "classification_confidence" DECIMAL(4,3),
    "classified_by" "ClassifiedBy",
    "source_channel" "DocumentSourceChannel" NOT NULL DEFAULT 'file',
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "stored_object_id" UUID NOT NULL,
    "thumbnail_object_id" UUID,
    "ocr_text_object_id" UUID,
    "width" INTEGER,
    "height" INTEGER,
    "rotation" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "engine" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "model_provider" TEXT,
    "model_name" TEXT,
    "model_version" TEXT,
    "prompt_version" TEXT,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'queued',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "cost_micros" INTEGER,
    "raw_text_object_id" UUID,
    "error_digest" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_candidates" (
    "id" UUID NOT NULL,
    "extraction_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "target_entity" TEXT NOT NULL,
    "target_field" TEXT NOT NULL,
    "group_key" TEXT,
    "page_number" INTEGER,
    "bounding_box" JSONB,
    "detected_text" TEXT NOT NULL,
    "proposed_value" JSONB,
    "confidence" DECIMAL(4,3) NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'proposed',
    "corrected_value" JSONB,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "resulting_entity_type" TEXT,
    "resulting_entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_reports" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "encounter_id" UUID,
    "kind" "DiagnosticReportKind" NOT NULL DEFAULT 'laboratory',
    "category" TEXT,
    "title" TEXT NOT NULL,
    "specimen_collected_at" TIMESTAMPTZ(6),
    "reported_at" TIMESTAMPTZ(6),
    "tested_at" DATE,
    "organization_id" UUID,
    "facility_name_text" TEXT,
    "ordering_practitioner_id" UUID,
    "reporting_practitioner_id" UUID,
    "modality" "ImagingModality",
    "body_site" TEXT,
    "impression_text" TEXT,
    "findings_text" TEXT,
    "conclusion_text" TEXT,
    "status" "DiagnosticReportStatus" NOT NULL DEFAULT 'final',
    "legacy_medical_report_id" UUID,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "diagnostic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostic_results" (
    "id" UUID NOT NULL,
    "diagnostic_report_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "analyte_key" TEXT NOT NULL,
    "analyte_label_text" TEXT,
    "loinc_code" TEXT,
    "entered_value_text" TEXT NOT NULL,
    "value_numeric" DECIMAL(14,4),
    "value_text" TEXT,
    "comparator" TEXT,
    "unit" TEXT,
    "entered_unit" TEXT,
    "reference_low" DECIMAL(14,4),
    "reference_high" DECIMAL(14,4),
    "reference_text" TEXT,
    "interpretation" "ObservationInterpretation",
    "specimen_type" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "superseded_by_id" UUID,
    "legacy_report_value_id" UUID,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "diagnostic_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_devices" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "MeasurementDeviceKind" NOT NULL,
    "platform" "MeasurementDevicePlatform" NOT NULL DEFAULT 'manual',
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_digest" TEXT,
    "label" TEXT,
    "last_sync_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "recorded_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "measurement_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "encounter_id" UUID,
    "concept" "ObservationConcept" NOT NULL,
    "concept_code" TEXT,
    "concept_system" TEXT,
    "value_numeric" DECIMAL(12,3),
    "value_numeric2" DECIMAL(12,3),
    "value_text" TEXT,
    "unit" TEXT NOT NULL,
    "entered_unit" TEXT,
    "entered_value_text" TEXT,
    "context" "ObservationContext",
    "body_site" TEXT,
    "method" TEXT,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "measured_at_local" TEXT,
    "interpretation" "ObservationInterpretation",
    "notes" TEXT,
    "device_id" UUID,
    "client_mutation_id" TEXT,
    "legacy_entity_type" TEXT,
    "legacy_id" UUID,
    "provenance_source" "RecordSource",
    "verification" "VerificationState",
    "recorded_via" TEXT,
    "recorded_by_user_id" UUID,
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

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_notices" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "body_object_id" UUID,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abha_links" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "abha_number_ciphertext" TEXT NOT NULL,
    "abha_number_digest" TEXT NOT NULL,
    "abha_address" TEXT,
    "status" "AbhaLinkStatus" NOT NULL DEFAULT 'active',
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_at" TIMESTAMPTZ(6),
    "profile_snapshot" JSONB,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "abha_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abdm_care_contexts" (
    "id" UUID NOT NULL,
    "abha_link_id" UUID NOT NULL,
    "hip_id" TEXT NOT NULL,
    "hip_name" TEXT,
    "patient_reference_number" TEXT NOT NULL,
    "care_context_reference" TEXT NOT NULL,
    "display" TEXT,
    "status" TEXT NOT NULL DEFAULT 'linked',
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abdm_care_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abdm_consent_artefacts" (
    "id" UUID NOT NULL,
    "abha_link_id" UUID NOT NULL,
    "consent_request_id" TEXT,
    "artefact_id" TEXT,
    "purpose_code" TEXT NOT NULL,
    "hi_types" TEXT[],
    "date_range_from" TIMESTAMPTZ(6),
    "date_range_to" TIMESTAMPTZ(6),
    "data_erase_at" TIMESTAMPTZ(6),
    "frequency" JSONB,
    "hiu_id" TEXT,
    "status" "AbdmConsentStatus" NOT NULL DEFAULT 'requested',
    "artefact_json" JSONB,
    "granted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "abdm_consent_artefacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abdm_transactions" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID,
    "kind" TEXT NOT NULL,
    "request_id" TEXT,
    "transaction_id" TEXT,
    "correlation_id" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request_digest" TEXT,
    "response_digest" TEXT,
    "error_code" TEXT,
    "error_text" TEXT,
    "gateway_env" "AbdmGatewayEnv" NOT NULL DEFAULT 'mock',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "abdm_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abdm_data_bundles" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "consent_artefact_id" UUID NOT NULL,
    "transaction_id" TEXT,
    "hi_type" TEXT NOT NULL,
    "encrypted_payload_object_id" UUID,
    "decrypted_at" TIMESTAMPTZ(6),
    "fhir_version" TEXT,
    "ig_version" TEXT,
    "entry_count" INTEGER,
    "import_status" "AbdmImportStatus" NOT NULL DEFAULT 'received',
    "erased_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abdm_data_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fhir_validation_failures" (
    "id" UUID NOT NULL,
    "bundle_id" UUID,
    "direction" TEXT NOT NULL,
    "ig_version" TEXT NOT NULL,
    "profile_url" TEXT,
    "resource_type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fhir_validation_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identifiers" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "assigner_organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'staff',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invited_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_patient_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "linked_via" "ProviderLinkVia" NOT NULL,
    "sections" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_proposals" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'proposed',
    "proposed_by_user_id" UUID NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "resulting_entity_type" TEXT,
    "resulting_entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_due_schedules" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "analyte_key" TEXT,
    "diagnostic_kind" TEXT,
    "label" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "recurrence_days" INTEGER,
    "source_prescription_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recorded_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_due_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "description" TEXT,
    "default_on" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percent" SMALLINT NOT NULL DEFAULT 0,
    "allow_profile_ids" UUID[],
    "environment" TEXT,
    "updated_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "patient_profile_id" UUID,
    "opened_by_user_id" UUID,
    "assigned_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_case_notes" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "author_admin_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grants" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "support_case_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "patient_notified_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "break_glass_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_sequence_idx" ON "prescription_items"("prescription_id", "sequence");

-- CreateIndex
CREATE INDEX "prescription_items_patient_profile_id_idx" ON "prescription_items"("patient_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_refill_plans_patient_medication_id_key" ON "medication_refill_plans"("patient_medication_id");

-- CreateIndex
CREATE INDEX "medication_refill_plans_patient_profile_id_projected_run_ou_idx" ON "medication_refill_plans"("patient_profile_id", "projected_run_out_on");

-- CreateIndex
CREATE INDEX "medication_dispenses_patient_profile_id_dispensed_at_idx" ON "medication_dispenses"("patient_profile_id", "dispensed_at");

-- CreateIndex
CREATE INDEX "medication_reconciliations_patient_profile_id_status_idx" ON "medication_reconciliations"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "medication_reconciliation_lines_reconciliation_id_idx" ON "medication_reconciliation_lines"("reconciliation_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_documents_legacy_prescription_document_id_key" ON "patient_documents"("legacy_prescription_document_id");

-- CreateIndex
CREATE INDEX "patient_documents_patient_profile_id_deleted_at_created_at_idx" ON "patient_documents"("patient_profile_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "patient_documents_prescription_id_idx" ON "patient_documents"("prescription_id");

-- CreateIndex
CREATE INDEX "patient_documents_diagnostic_report_id_idx" ON "patient_documents"("diagnostic_report_id");

-- CreateIndex
CREATE INDEX "patient_documents_encounter_id_idx" ON "patient_documents"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_document_id_page_number_key" ON "document_pages"("document_id", "page_number");

-- CreateIndex
CREATE INDEX "document_extractions_document_id_created_at_idx" ON "document_extractions"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "document_candidates_extraction_id_idx" ON "document_candidates"("extraction_id");

-- CreateIndex
CREATE INDEX "document_candidates_patient_profile_id_status_idx" ON "document_candidates"("patient_profile_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_reports_legacy_medical_report_id_key" ON "diagnostic_reports"("legacy_medical_report_id");

-- CreateIndex
CREATE INDEX "diagnostic_reports_patient_profile_id_tested_at_idx" ON "diagnostic_reports"("patient_profile_id", "tested_at");

-- CreateIndex
CREATE INDEX "diagnostic_reports_patient_profile_id_kind_idx" ON "diagnostic_reports"("patient_profile_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostic_results_legacy_report_value_id_key" ON "diagnostic_results"("legacy_report_value_id");

-- CreateIndex
CREATE INDEX "diagnostic_results_diagnostic_report_id_sequence_idx" ON "diagnostic_results"("diagnostic_report_id", "sequence");

-- CreateIndex
CREATE INDEX "diagnostic_results_patient_profile_id_analyte_key_created_a_idx" ON "diagnostic_results"("patient_profile_id", "analyte_key", "created_at");

-- CreateIndex
CREATE INDEX "measurement_devices_patient_profile_id_idx" ON "measurement_devices"("patient_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "observations_client_mutation_id_key" ON "observations"("client_mutation_id");

-- CreateIndex
CREATE INDEX "observations_patient_profile_id_concept_measured_at_idx" ON "observations"("patient_profile_id", "concept", "measured_at" DESC);

-- CreateIndex
CREATE INDEX "observations_patient_profile_id_measured_at_idx" ON "observations"("patient_profile_id", "measured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "observations_legacy_entity_type_legacy_id_key" ON "observations"("legacy_entity_type", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_notices_purpose_version_locale_key" ON "consent_notices"("purpose", "version", "locale");

-- CreateIndex
CREATE INDEX "abha_links_patient_profile_id_status_idx" ON "abha_links"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "abha_links_abha_number_digest_idx" ON "abha_links"("abha_number_digest");

-- CreateIndex
CREATE UNIQUE INDEX "abdm_care_contexts_abha_link_id_hip_id_care_context_referen_key" ON "abdm_care_contexts"("abha_link_id", "hip_id", "care_context_reference");

-- CreateIndex
CREATE UNIQUE INDEX "abdm_consent_artefacts_artefact_id_key" ON "abdm_consent_artefacts"("artefact_id");

-- CreateIndex
CREATE INDEX "abdm_consent_artefacts_abha_link_id_status_idx" ON "abdm_consent_artefacts"("abha_link_id", "status");

-- CreateIndex
CREATE INDEX "abdm_transactions_patient_profile_id_started_at_idx" ON "abdm_transactions"("patient_profile_id", "started_at");

-- CreateIndex
CREATE INDEX "abdm_transactions_request_id_idx" ON "abdm_transactions"("request_id");

-- CreateIndex
CREATE INDEX "abdm_transactions_transaction_id_idx" ON "abdm_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "abdm_transactions_kind_status_started_at_idx" ON "abdm_transactions"("kind", "status", "started_at");

-- CreateIndex
CREATE INDEX "abdm_data_bundles_patient_profile_id_import_status_idx" ON "abdm_data_bundles"("patient_profile_id", "import_status");

-- CreateIndex
CREATE INDEX "fhir_validation_failures_direction_created_at_idx" ON "fhir_validation_failures"("direction", "created_at");

-- CreateIndex
CREATE INDEX "external_identifiers_system_value_idx" ON "external_identifiers"("system", "value");

-- CreateIndex
CREATE UNIQUE INDEX "external_identifiers_entity_type_entity_id_system_key" ON "external_identifiers"("entity_type", "entity_id", "system");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "provider_patient_links_patient_profile_id_status_idx" ON "provider_patient_links"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "provider_patient_links_organization_id_status_idx" ON "provider_patient_links"("organization_id", "status");

-- CreateIndex
CREATE INDEX "provider_proposals_patient_profile_id_status_created_at_idx" ON "provider_proposals"("patient_profile_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "provider_proposals_organization_id_status_idx" ON "provider_proposals"("organization_id", "status");

-- CreateIndex
CREATE INDEX "test_due_schedules_patient_profile_id_due_on_idx" ON "test_due_schedules"("patient_profile_id", "due_on");

-- CreateIndex
CREATE INDEX "support_cases_status_created_at_idx" ON "support_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_case_notes_case_id_created_at_idx" ON "support_case_notes"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "break_glass_grants_patient_profile_id_expires_at_idx" ON "break_glass_grants"("patient_profile_id", "expires_at");

-- CreateIndex
CREATE INDEX "break_glass_grants_admin_user_id_granted_at_idx" ON "break_glass_grants"("admin_user_id", "granted_at");

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_refill_plans" ADD CONSTRAINT "medication_refill_plans_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_dispenses" ADD CONSTRAINT "medication_dispenses_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_reconciliation_lines" ADD CONSTRAINT "medication_reconciliation_lines_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "medication_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "patient_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "patient_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_candidates" ADD CONSTRAINT "document_candidates_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "document_extractions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostic_results" ADD CONSTRAINT "diagnostic_results_diagnostic_report_id_fkey" FOREIGN KEY ("diagnostic_report_id") REFERENCES "diagnostic_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_devices" ADD CONSTRAINT "measurement_devices_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "measurement_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abha_links" ADD CONSTRAINT "abha_links_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abdm_care_contexts" ADD CONSTRAINT "abdm_care_contexts_abha_link_id_fkey" FOREIGN KEY ("abha_link_id") REFERENCES "abha_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abdm_consent_artefacts" ADD CONSTRAINT "abdm_consent_artefacts_abha_link_id_fkey" FOREIGN KEY ("abha_link_id") REFERENCES "abha_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abdm_data_bundles" ADD CONSTRAINT "abdm_data_bundles_consent_artefact_id_fkey" FOREIGN KEY ("consent_artefact_id") REFERENCES "abdm_consent_artefacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_patient_links" ADD CONSTRAINT "provider_patient_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_patient_links" ADD CONSTRAINT "provider_patient_links_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_proposals" ADD CONSTRAINT "provider_proposals_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "provider_patient_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_due_schedules" ADD CONSTRAINT "test_due_schedules_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_notes" ADD CONSTRAINT "support_case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

