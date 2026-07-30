-- AlterTable
ALTER TABLE "practitioners" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "practitioner_id" UUID,
    "prescribed_at" DATE,
    "notes" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescriptions_patient_profile_id_prescribed_at_idx" ON "prescriptions"("patient_profile_id", "prescribed_at");

-- AlterTable
ALTER TABLE "patient_medications" ADD COLUMN "prescription_id" UUID;

-- AlterTable
ALTER TABLE "prescription_documents" ADD COLUMN "prescription_id" UUID;

-- CreateIndex
CREATE INDEX "patient_medications_prescription_id_idx" ON "patient_medications"("prescription_id");

-- CreateIndex
CREATE INDEX "prescription_documents_prescription_id_idx" ON "prescription_documents"("prescription_id");

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "practitioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_documents" ADD CONSTRAINT "prescription_documents_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
