-- CreateEnum
CREATE TYPE "ShareLinkKind" AS ENUM ('link', 'qr');

-- CreateEnum
CREATE TYPE "ShareAccessResult" AS ENUM ('success', 'expired', 'revoked', 'not_found');

-- CreateTable
CREATE TABLE "share_packages" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "sections" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "share_package_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" "ShareLinkKind" NOT NULL DEFAULT 'link',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_access_events" (
    "id" UUID NOT NULL,
    "share_link_id" UUID NOT NULL,
    "result" "ShareAccessResult" NOT NULL,
    "ip_digest" TEXT,
    "accessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_access_events_share_link_id_accessed_at_idx" ON "share_access_events"("share_link_id", "accessed_at");

-- AddForeignKey
ALTER TABLE "share_packages" ADD CONSTRAINT "share_packages_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_share_package_id_fkey" FOREIGN KEY ("share_package_id") REFERENCES "share_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_access_events" ADD CONSTRAINT "share_access_events_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
