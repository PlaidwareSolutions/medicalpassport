-- AlterEnum
ALTER TYPE "DocumentKind" ADD VALUE 'lab_report';
ALTER TYPE "DocumentKind" ADD VALUE 'scan_report';

-- CreateEnum
CREATE TYPE "MedicalReportKind" AS ENUM ('blood_test', 'urine_test', 'imaging', 'ecg', 'pathology', 'discharge_summary', 'other');

-- CreateTable
CREATE TABLE "medical_reports" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "kind" "MedicalReportKind" NOT NULL,
    "label" TEXT,
    "facility_name" TEXT,
    "practitioner_id" UUID,
    "tested_at" DATE,
    "notes" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_reports_patient_profile_id_tested_at_idx" ON "medical_reports"("patient_profile_id", "tested_at");

-- AlterTable
ALTER TABLE "prescription_documents" ADD COLUMN "report_id" UUID;

-- CreateIndex
CREATE INDEX "prescription_documents_report_id_idx" ON "prescription_documents"("report_id");

-- AddForeignKey
ALTER TABLE "medical_reports" ADD CONSTRAINT "medical_reports_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reports" ADD CONSTRAINT "medical_reports_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "practitioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_documents" ADD CONSTRAINT "prescription_documents_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "medical_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
