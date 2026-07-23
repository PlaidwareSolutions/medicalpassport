-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AdminDuty" AS ENUM ('catalog_write', 'catalog_approve', 'audit_search', 'incident_response', 'operations_view', 'rules_view', 'super_admin');

-- CreateEnum
CREATE TYPE "CatalogEntityType" AS ENUM ('ingredient', 'manufacturer', 'brand', 'dosage_form', 'route', 'product', 'classification');

-- CreateEnum
CREATE TYPE "CatalogChangeOperation" AS ENUM ('create', 'update', 'deprecate');

-- CreateEnum
CREATE TYPE "CatalogChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AdminUserStatus" NOT NULL DEFAULT 'active',
    "duties" "AdminDuty"[] DEFAULT ARRAY[]::"AdminDuty"[],
    "mfa_secret_ciphertext" TEXT,
    "mfa_enrolled_at" TIMESTAMPTZ(6),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "user_agent_digest" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_change_requests" (
    "id" UUID NOT NULL,
    "entity_type" "CatalogEntityType" NOT NULL,
    "entity_id" UUID,
    "operation" "CatalogChangeOperation" NOT NULL,
    "proposed_data" JSONB NOT NULL,
    "status" "CatalogChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_by_admin_user_id" UUID NOT NULL,
    "decided_by_admin_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "is_solo_approval" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalog_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_refresh_token_hash_key" ON "admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_revoked_at_idx" ON "admin_sessions"("admin_user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "catalog_change_requests_status_entity_type_idx" ON "catalog_change_requests"("status", "entity_type");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_requested_by_admin_user_id_fkey" FOREIGN KEY ("requested_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_decided_by_admin_user_id_fkey" FOREIGN KEY ("decided_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
