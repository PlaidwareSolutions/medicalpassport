-- CreateEnum
CREATE TYPE "ClinicalRelationshipEntity" AS ENUM ('condition', 'medication', 'practitioner', 'analyte', 'observation_concept', 'diagnostic_result', 'observation');

-- CreateEnum
CREATE TYPE "ClinicalRelationshipKind" AS ENUM ('medicine_for_condition', 'result_tracks_condition', 'measurement_tracks_condition', 'provider_for_condition', 'provider_for_medicine');

-- CreateEnum
CREATE TYPE "ClinicalRelationshipBasis" AS ENUM ('medicine_reason_condition', 'medicine_practitioner', 'prescription_practitioner', 'condition_usual_monitoring', 'patient_stated');

-- CreateEnum
CREATE TYPE "ClinicalRelationshipOrigin" AS ENUM ('inferred', 'patient_stated');

-- CreateEnum
CREATE TYPE "ClinicalRelationshipStatus" AS ENUM ('suggested', 'confirmed', 'dismissed');

-- CreateTable
CREATE TABLE "clinical_relationships" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "ClinicalRelationshipKind" NOT NULL,
    "from_type" "ClinicalRelationshipEntity" NOT NULL,
    "from_id" UUID,
    "from_key" TEXT,
    "to_type" "ClinicalRelationshipEntity" NOT NULL,
    "to_id" UUID,
    "to_key" TEXT,
    "edge_key" TEXT NOT NULL,
    "status" "ClinicalRelationshipStatus" NOT NULL DEFAULT 'suggested',
    "origin" "ClinicalRelationshipOrigin" NOT NULL,
    "basis" "ClinicalRelationshipBasis" NOT NULL,
    "basis_detail" JSONB,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "dismissed_by_user_id" UUID,
    "dismissed_at" TIMESTAMPTZ(6),
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

    CONSTRAINT "clinical_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_relationships_patient_profile_id_status_idx" ON "clinical_relationships"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "clinical_relationships_patient_profile_id_kind_to_id_idx" ON "clinical_relationships"("patient_profile_id", "kind", "to_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_relationships_patient_profile_id_edge_key_key" ON "clinical_relationships"("patient_profile_id", "edge_key");

