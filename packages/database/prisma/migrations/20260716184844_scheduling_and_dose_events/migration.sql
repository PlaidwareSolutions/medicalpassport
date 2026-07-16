-- CreateEnum
CREATE TYPE "ScheduleRecurrence" AS ENUM ('daily');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "DoseStatus" AS ENUM ('upcoming', 'taken', 'skipped', 'missed', 'snoozed', 'could_not_take', 'unavailable', 'problem', 'taken_other_time', 'cancelled');

-- CreateEnum
CREATE TYPE "DoseAction" AS ENUM ('taken', 'skipped', 'snoozed', 'could_not_take', 'unavailable', 'problem', 'taken_other_time', 'cancelled');

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" UUID NOT NULL,
    "patient_medication_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "slots" JSONB NOT NULL,
    "recurrence" "ScheduleRecurrence" NOT NULL DEFAULT 'daily',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_doses" (
    "id" UUID NOT NULL,
    "medication_schedule_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "slot_label" TEXT NOT NULL,
    "quantity" DECIMAL(6,2) NOT NULL,
    "status" "DoseStatus" NOT NULL DEFAULT 'upcoming',
    "snoozed_until" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_doses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_events" (
    "id" UUID NOT NULL,
    "scheduled_dose_id" UUID,
    "patient_medication_id" UUID NOT NULL,
    "action" "DoseAction" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "client_mutation_id" UUID,
    "channel" TEXT NOT NULL DEFAULT 'pwa',

    CONSTRAINT "dose_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medication_schedules_patient_medication_id_key" ON "medication_schedules"("patient_medication_id");

-- CreateIndex
CREATE INDEX "scheduled_doses_due_at_status_idx" ON "scheduled_doses"("due_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_doses_medication_schedule_id_due_at_key" ON "scheduled_doses"("medication_schedule_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "dose_events_client_mutation_id_key" ON "dose_events"("client_mutation_id");

-- CreateIndex
CREATE INDEX "dose_events_patient_medication_id_recorded_at_idx" ON "dose_events"("patient_medication_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_doses" ADD CONSTRAINT "scheduled_doses_medication_schedule_id_fkey" FOREIGN KEY ("medication_schedule_id") REFERENCES "medication_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_scheduled_dose_id_fkey" FOREIGN KEY ("scheduled_dose_id") REFERENCES "scheduled_doses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
