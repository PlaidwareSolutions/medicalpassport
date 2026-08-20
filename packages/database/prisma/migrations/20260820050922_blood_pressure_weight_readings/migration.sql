-- CreateTable
CREATE TABLE "blood_pressure_readings" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "systolic" SMALLINT NOT NULL,
    "diastolic" SMALLINT NOT NULL,
    "pulse_bpm" SMALLINT,
    "note" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "blood_pressure_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_readings" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weight_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blood_pressure_readings_patient_profile_id_measured_at_idx" ON "blood_pressure_readings"("patient_profile_id", "measured_at");

-- CreateIndex
CREATE INDEX "weight_readings_patient_profile_id_measured_at_idx" ON "weight_readings"("patient_profile_id", "measured_at");

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_readings" ADD CONSTRAINT "weight_readings_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
