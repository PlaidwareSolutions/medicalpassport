-- CreateEnum
CREATE TYPE "SafetyFindingSeverity" AS ENUM ('info', 'low', 'moderate', 'high');

-- CreateEnum
CREATE TYPE "SafetyFindingStatus" AS ENUM ('open', 'acknowledged', 'reviewed_with_professional', 'resolved');

-- CreateEnum
CREATE TYPE "SafetyFindingActionType" AS ENUM ('acknowledged', 'note_added', 'reviewed_with_professional', 'resolved');

-- CreateTable
CREATE TABLE "safety_evaluations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "safety_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_findings" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "SafetyFindingSeverity" NOT NULL,
    "medication_ids" TEXT[],
    "rule_key" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "explanation_key" TEXT NOT NULL,
    "detail" JSONB,
    "status" "SafetyFindingStatus" NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_finding_actions" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "action" "SafetyFindingActionType" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_finding_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_evaluations_patient_profile_id_started_at_idx" ON "safety_evaluations"("patient_profile_id", "started_at");

-- CreateIndex
CREATE INDEX "safety_findings_patient_profile_id_status_idx" ON "safety_findings"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "safety_findings_evaluation_id_idx" ON "safety_findings"("evaluation_id");

-- AddForeignKey
ALTER TABLE "safety_evaluations" ADD CONSTRAINT "safety_evaluations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_findings" ADD CONSTRAINT "safety_findings_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "safety_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_finding_actions" ADD CONSTRAINT "safety_finding_actions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "safety_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
