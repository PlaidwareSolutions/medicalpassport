-- Records whether a human actually chose the dose unit, as opposed to the app
-- having defaulted it. Until 2026-07-25 the add/edit screens hardcoded
-- "tablet" on every save (fixed in 10afc28), so historic rows carry a unit
-- nobody picked. Harmless while the unit was only rendered as text; not
-- harmless now that the medicines list draws it as a picture.
ALTER TABLE "medication_instructions" ADD COLUMN "dose_unit_confirmed_at" TIMESTAMPTZ(6);

-- Backfill only what can be known to be a real choice:
--   * any non-tablet unit — the hardcoded default was "tablet", so ml/unit/
--     puff/etc. can only have come from a person picking it;
--   * anything written on or after the type-picker fix, by which point every
--     save carried the patient's own selection.
-- Everything else stays NULL and will be asked about, rather than guessed.
UPDATE "medication_instructions"
SET "dose_unit_confirmed_at" = "confirmed_at"
WHERE "dose_unit" <> 'tablet'
   OR "created_at" >= TIMESTAMPTZ '2026-07-25 00:00:00+05:30';

CREATE INDEX "medication_instructions_dose_unit_confirmed_at_idx"
  ON "medication_instructions" ("dose_unit_confirmed_at")
  WHERE "superseded_at" IS NULL AND "dose_unit_confirmed_at" IS NULL;
