-- Per-profile IANA timezone (docs/16): anchors the profile's clinical day.
-- Every existing profile is in the launch market, so the default backfills
-- correctly.
ALTER TABLE "patient_profiles" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
