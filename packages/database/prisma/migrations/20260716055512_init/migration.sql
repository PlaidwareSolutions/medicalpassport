-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deletion_pending', 'deleted');

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('browser', 'android', 'ios');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login', 'recovery', 'share_verification');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('female', 'male', 'other', 'undisclosed');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('invited', 'active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "CaregiverScope" AS ENUM ('view_medications', 'view_schedule', 'manage_reminders', 'record_doses', 'add_medications', 'edit_medications', 'review_concerns', 'share_records', 'manage_profile', 'full_management');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('data_processing', 'sms_reminders', 'whatsapp_reminders', 'email', 'caregiver_access', 'sharing', 'ai_processing', 'emergency_card');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('mild', 'moderate', 'severe', 'unknown');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('patient', 'document', 'professional');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'deprecated', 'banned');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('immediate', 'sustained', 'extended', 'controlled', 'unspecified');

-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('current', 'paused', 'completed', 'stopped', 'unknown');

-- CreateEnum
CREATE TYPE "NormalizationStatus" AS ENUM ('unmatched', 'candidate', 'confirmed');

-- CreateEnum
CREATE TYPE "MedicationSource" AS ENUM ('search', 'manual', 'extraction', 'previous', 'import');

-- CreateEnum
CREATE TYPE "FrequencyCode" AS ENUM ('OD', 'BD', 'TDS', 'QID', 'SOS', 'HS', 'PATTERN', 'ALTERNATE_DAY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FoodInstruction" AS ENUM ('before', 'with', 'after', 'any', 'bedtime');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('patient', 'caregiver', 'admin', 'system', 'share_visitor');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_digest" TEXT NOT NULL,
    "phone_ciphertext" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "email" TEXT,
    "preferred_locale" TEXT NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "DeviceKind" NOT NULL DEFAULT 'browser',
    "label" TEXT,
    "user_agent_digest" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_device_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_attempts" (
    "id" UUID NOT NULL,
    "phone_digest" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'login',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "verify_attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_digest" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "claimed_by_user_id" UUID,
    "display_name" TEXT NOT NULL,
    "year_of_birth" SMALLINT,
    "sex" "Sex",
    "preferred_locale" TEXT NOT NULL DEFAULT 'en',
    "emergency_card" JSONB,
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_relationships" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "caregiver_user_id" UUID,
    "invited_phone_digest" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'invited',
    "accepted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "caregiver_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_permissions" (
    "id" UUID NOT NULL,
    "caregiver_relationship_id" UUID NOT NULL,
    "scope" "CaregiverScope" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "caregiver_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" JSONB,
    "status" "ConsentStatus" NOT NULL DEFAULT 'active',
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "actor_user_id" UUID,
    "context" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners" (
    "id" UUID NOT NULL,
    "created_by_profile_id" UUID,
    "display_name" TEXT NOT NULL,
    "speciality" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "allergen_ingredient_id" UUID,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'unknown',
    "reaction_note" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'patient',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_conditions" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'patient',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "medication_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manufacturer_id" UUID,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "medication_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dosage_forms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "dosage_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administration_routes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "administration_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapeutic_classes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,

    CONSTRAINT "therapeutic_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_products" (
    "id" UUID NOT NULL,
    "brand_id" UUID,
    "generic_name" TEXT NOT NULL,
    "dosage_form_id" UUID,
    "route_id" UUID,
    "release_type" "ReleaseType" NOT NULL DEFAULT 'unspecified',
    "is_combination" BOOLEAN NOT NULL DEFAULT false,
    "strength_label" TEXT,
    "regulatory_ref" TEXT,
    "source_name" TEXT,
    "source_version" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_product_ingredients" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "strength_value" DECIMAL(10,3),
    "strength_unit" TEXT,

    CONSTRAINT "medication_product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_classifications" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "source" TEXT,

    CONSTRAINT "product_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medications" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "product_id" UUID,
    "entered_name" TEXT NOT NULL,
    "normalization_status" "NormalizationStatus" NOT NULL DEFAULT 'unmatched',
    "patient_reason" TEXT,
    "practitioner_id" UUID,
    "source" "MedicationSource" NOT NULL,
    "status" "MedicationStatus" NOT NULL DEFAULT 'current',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_reason" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "is_prn" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_instructions" (
    "id" UUID NOT NULL,
    "patient_medication_id" UUID NOT NULL,
    "dose_quantity" DECIMAL(6,2) NOT NULL,
    "dose_unit" TEXT NOT NULL,
    "frequency_code" "FrequencyCode" NOT NULL,
    "pattern" TEXT,
    "food_instruction" "FoodInstruction" NOT NULL DEFAULT 'any',
    "duration_days" INTEGER,
    "original_text" TEXT,
    "confirmed_by_user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_changes" (
    "id" UUID NOT NULL,
    "patient_medication_id" UUID NOT NULL,
    "change" TEXT NOT NULL,
    "detail" JSONB,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_mutations" (
    "id" UUID NOT NULL,
    "client_mutation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "patient_profile_id" UUID,
    "entity" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "result_digest" TEXT,
    "result_body" JSONB,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "patient_profile_id" UUID,
    "correlation_id" TEXT,
    "context" JSONB,
    "prev_hash" TEXT,
    "row_hash" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_digest_key" ON "users"("phone_digest");

-- CreateIndex
CREATE INDEX "user_devices_user_id_last_seen_at_idx" ON "user_devices"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "otp_attempts_phone_digest_created_at_idx" ON "otp_attempts"("phone_digest", "created_at");

-- CreateIndex
CREATE INDEX "patient_profiles_owner_user_id_idx" ON "patient_profiles"("owner_user_id");

-- CreateIndex
CREATE INDEX "caregiver_relationships_patient_profile_id_status_idx" ON "caregiver_relationships"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "caregiver_relationships_caregiver_user_id_status_idx" ON "caregiver_relationships"("caregiver_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_permissions_caregiver_relationship_id_scope_key" ON "caregiver_permissions"("caregiver_relationship_id", "scope");

-- CreateIndex
CREATE INDEX "consents_patient_profile_id_type_status_idx" ON "consents"("patient_profile_id", "type", "status");

-- CreateIndex
CREATE INDEX "consent_events_consent_id_occurred_at_idx" ON "consent_events"("consent_id", "occurred_at");

-- CreateIndex
CREATE INDEX "patient_allergies_patient_profile_id_idx" ON "patient_allergies"("patient_profile_id");

-- CreateIndex
CREATE INDEX "patient_conditions_patient_profile_id_idx" ON "patient_conditions"("patient_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_ingredients_name_key" ON "medication_ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE INDEX "medication_brands_name_idx" ON "medication_brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "dosage_forms_name_key" ON "dosage_forms"("name");

-- CreateIndex
CREATE UNIQUE INDEX "administration_routes_name_key" ON "administration_routes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "therapeutic_classes_name_key" ON "therapeutic_classes"("name");

-- CreateIndex
CREATE INDEX "medication_products_generic_name_idx" ON "medication_products"("generic_name");

-- CreateIndex
CREATE UNIQUE INDEX "medication_product_ingredients_product_id_ingredient_id_key" ON "medication_product_ingredients"("product_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_classifications_product_id_class_id_key" ON "product_classifications"("product_id", "class_id");

-- CreateIndex
CREATE INDEX "patient_medications_patient_profile_id_status_idx" ON "patient_medications"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "medication_instructions_patient_medication_id_superseded_at_idx" ON "medication_instructions"("patient_medication_id", "superseded_at");

-- CreateIndex
CREATE INDEX "medication_changes_patient_medication_id_occurred_at_idx" ON "medication_changes"("patient_medication_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "offline_mutations_client_mutation_id_key" ON "offline_mutations"("client_mutation_id");

-- CreateIndex
CREATE INDEX "offline_mutations_user_id_applied_at_idx" ON "offline_mutations"("user_id", "applied_at");

-- CreateIndex
CREATE INDEX "audit_events_patient_profile_id_occurred_at_idx" ON "audit_events"("patient_profile_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_seq_idx" ON "audit_events"("seq");

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_device_id_fkey" FOREIGN KEY ("user_device_id") REFERENCES "user_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_relationships" ADD CONSTRAINT "caregiver_relationships_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_relationships" ADD CONSTRAINT "caregiver_relationships_caregiver_user_id_fkey" FOREIGN KEY ("caregiver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_permissions" ADD CONSTRAINT "caregiver_permissions_caregiver_relationship_id_fkey" FOREIGN KEY ("caregiver_relationship_id") REFERENCES "caregiver_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_created_by_profile_id_fkey" FOREIGN KEY ("created_by_profile_id") REFERENCES "patient_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_allergen_ingredient_id_fkey" FOREIGN KEY ("allergen_ingredient_id") REFERENCES "medication_ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_brands" ADD CONSTRAINT "medication_brands_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_products" ADD CONSTRAINT "medication_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "medication_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_products" ADD CONSTRAINT "medication_products_dosage_form_id_fkey" FOREIGN KEY ("dosage_form_id") REFERENCES "dosage_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_products" ADD CONSTRAINT "medication_products_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "administration_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_product_ingredients" ADD CONSTRAINT "medication_product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "medication_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_product_ingredients" ADD CONSTRAINT "medication_product_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "medication_ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_classifications" ADD CONSTRAINT "product_classifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "medication_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_classifications" ADD CONSTRAINT "product_classifications_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "therapeutic_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "medication_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "practitioners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_instructions" ADD CONSTRAINT "medication_instructions_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_changes" ADD CONSTRAINT "medication_changes_patient_medication_id_fkey" FOREIGN KEY ("patient_medication_id") REFERENCES "patient_medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
