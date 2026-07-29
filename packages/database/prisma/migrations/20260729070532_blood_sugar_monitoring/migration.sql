-- CreateEnum
CREATE TYPE "GlucoseReadingContext" AS ENUM ('before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'during_night', 'random');

-- CreateTable
CREATE TABLE "glucose_readings" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "context" "GlucoseReadingContext" NOT NULL,
    "value_mg_dl" SMALLINT NOT NULL,
    "note" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "glucose_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkup_records" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "checkup_date" DATE NOT NULL,
    "fasting_glucose_mg_dl" SMALLINT,
    "post_prandial_glucose_mg_dl" SMALLINT,
    "hba1c_percent" DECIMAL(4,1),
    "blood_pressure_systolic" SMALLINT,
    "blood_pressure_diastolic" SMALLINT,
    "weight_kg" DECIMAL(5,2),
    "waist_circumference_cm" DECIMAL(5,1),
    "cholesterol_mg_dl" SMALLINT,
    "treatment_changes" TEXT,
    "next_appointment_date" DATE,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checkup_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "glucose_readings_patient_profile_id_measured_at_idx" ON "glucose_readings"("patient_profile_id", "measured_at");

-- CreateIndex
CREATE INDEX "checkup_records_patient_profile_id_checkup_date_idx" ON "checkup_records"("patient_profile_id", "checkup_date");

-- AddForeignKey
ALTER TABLE "glucose_readings" ADD CONSTRAINT "glucose_readings_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkup_records" ADD CONSTRAINT "checkup_records_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
