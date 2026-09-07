-- ADR-V2-009: the organization that sent a proposal sees what the patient
-- actually decided, not just "accepted"/"declined". `declined_lines` holds the
-- indexes into payload.lines the patient said no to while accepting the rest
-- (H-43); `decision_reason` holds the patient's own words on a rejection,
-- which the app already tells them "only you and the clinic that sent this
-- will see".
-- AlterTable
ALTER TABLE "provider_proposals" ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "declined_lines" INTEGER[];
