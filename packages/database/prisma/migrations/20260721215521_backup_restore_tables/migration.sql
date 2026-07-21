-- CreateEnum
CREATE TYPE "BackupExecutionStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "RestoreTestStatus" AS ENUM ('running', 'passed', 'failed');

-- CreateTable
CREATE TABLE "backup_executions" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" "BackupExecutionStatus" NOT NULL DEFAULT 'running',
    "object_key" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "table_row_counts" JSONB,
    "error_digest" TEXT,

    CONSTRAINT "backup_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_tests" (
    "id" UUID NOT NULL,
    "backup_execution_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "status" "RestoreTestStatus" NOT NULL DEFAULT 'running',
    "row_counts_match" BOOLEAN,
    "detail" JSONB,
    "error_digest" TEXT,

    CONSTRAINT "restore_tests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_backup_execution_id_fkey" FOREIGN KEY ("backup_execution_id") REFERENCES "backup_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
