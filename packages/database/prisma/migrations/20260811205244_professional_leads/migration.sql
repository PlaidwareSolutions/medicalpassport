-- CreateEnum
CREATE TYPE "ProfessionalRole" AS ENUM ('doctor', 'pharmacist', 'clinic_owner', 'hospital_admin', 'care_coordinator', 'other');

-- CreateTable
CREATE TABLE "professional_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "role" "ProfessionalRole" NOT NULL,
    "city" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "consent_to_contact" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professional_leads_created_at_idx" ON "professional_leads"("created_at");
