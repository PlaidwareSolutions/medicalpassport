-- CreateEnum
CREATE TYPE "StoredObjectBucket" AS ENUM ('patient_docs', 'ocr_tmp');

-- CreateEnum
CREATE TYPE "StoredObjectStatus" AS ENUM ('pending', 'verified', 'quarantined', 'deleted');

-- CreateEnum
CREATE TYPE "ObjectAccessOperation" AS ENUM ('presign_upload', 'presign_download', 'stream', 'delete');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('prescription', 'strip', 'box', 'bottle', 'discharge_summary', 'other');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('pending_upload', 'uploaded', 'verified', 'quarantined', 'processing', 'processed', 'failed', 'deleted');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ExtractionField" AS ENUM ('brand_name', 'frequency', 'food_instruction');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('proposed', 'confirmed', 'corrected', 'rejected');

-- CreateTable
CREATE TABLE "stored_objects" (
    "id" UUID NOT NULL,
    "bucket" "StoredObjectBucket" NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" TEXT,
    "size_bytes" INTEGER,
    "content_type" TEXT,
    "status" "StoredObjectStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_access_events" (
    "id" UUID NOT NULL,
    "stored_object_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "operation" "ObjectAccessOperation" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_documents" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "stored_object_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'prescription',
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending_upload',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prescription_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_extractions" (
    "id" UUID NOT NULL,
    "prescription_document_id" UUID NOT NULL,
    "engine" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'queued',
    "raw_text" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_candidates" (
    "id" UUID NOT NULL,
    "extraction_id" UUID NOT NULL,
    "field" "ExtractionField" NOT NULL,
    "detected_text" TEXT NOT NULL,
    "proposed_value" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'proposed',
    "confirmed_value" TEXT,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_objects_object_key_key" ON "stored_objects"("object_key");

-- CreateIndex
CREATE INDEX "object_access_events_stored_object_id_occurred_at_idx" ON "object_access_events"("stored_object_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_documents_stored_object_id_key" ON "prescription_documents"("stored_object_id");

-- CreateIndex
CREATE INDEX "prescription_documents_patient_profile_id_idx" ON "prescription_documents"("patient_profile_id");

-- AddForeignKey
ALTER TABLE "object_access_events" ADD CONSTRAINT "object_access_events_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_documents" ADD CONSTRAINT "prescription_documents_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_documents" ADD CONSTRAINT "prescription_documents_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_extractions" ADD CONSTRAINT "prescription_extractions_prescription_document_id_fkey" FOREIGN KEY ("prescription_document_id") REFERENCES "prescription_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "prescription_extractions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
