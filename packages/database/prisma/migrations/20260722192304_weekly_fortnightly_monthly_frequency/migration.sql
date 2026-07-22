-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FrequencyCode" ADD VALUE 'FORTNIGHTLY';
ALTER TYPE "FrequencyCode" ADD VALUE 'MONTHLY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScheduleRecurrence" ADD VALUE 'weekly';
ALTER TYPE "ScheduleRecurrence" ADD VALUE 'fortnightly';
ALTER TYPE "ScheduleRecurrence" ADD VALUE 'monthly';

-- AlterTable
ALTER TABLE "medication_schedules" ADD COLUMN     "anchor_date" DATE;
