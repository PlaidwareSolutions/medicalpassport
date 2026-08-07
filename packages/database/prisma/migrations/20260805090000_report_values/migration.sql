-- Structured lab values transcribed off test reports (docs/07 screen 44).
-- Purely additive; the analyte column is TEXT against the closed vocabulary
-- in @medpass/domain (provisional pending clinical validation, docs/34).
CREATE TABLE "report_values" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "analyte" TEXT NOT NULL,
    "other_label" TEXT,
    "entered_value" TEXT NOT NULL,
    "numeric_value" DECIMAL(10,3),
    "reference_text" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_values_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_values_patient_profile_id_analyte_idx" ON "report_values"("patient_profile_id", "analyte");
CREATE INDEX "report_values_report_id_idx" ON "report_values"("report_id");

ALTER TABLE "report_values" ADD CONSTRAINT "report_values_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "medical_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_values" ADD CONSTRAINT "report_values_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
