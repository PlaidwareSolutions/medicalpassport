-- ProfessionalLead 24-month retention basis (Session 17).
-- Add last_interaction_at. Existing rows: the only interaction knowable is
-- creation, so backfill to created_at (never fabricate a later interaction).
-- New rows default to now(), which equals created_at within the same INSERT
-- transaction.
ALTER TABLE "professional_leads" ADD COLUMN "last_interaction_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- Backfill existing rows to their creation time (truthful historical semantic).
UPDATE "professional_leads" SET "last_interaction_at" = "created_at";

-- Index for the retention cleanup query (avoids a full scan as leads grow).
CREATE INDEX "professional_leads_last_interaction_at_idx" ON "professional_leads"("last_interaction_at");
