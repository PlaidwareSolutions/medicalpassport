-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "patient_medication_id" UUID;

-- AlterTable
ALTER TABLE "patient_medications" ADD COLUMN     "quantity_on_hand" DECIMAL(8,2);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
