-- AlterTable
ALTER TABLE "user_devices" ADD COLUMN "trust_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_trust_token_hash_key" ON "user_devices"("trust_token_hash");
