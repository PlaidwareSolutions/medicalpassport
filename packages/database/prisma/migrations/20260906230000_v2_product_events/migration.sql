-- CreateTable
CREATE TABLE "product_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "profile_digest" TEXT,
    "user_digest" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "locale" TEXT,
    "client_kind" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_events_name_occurred_at_idx" ON "product_events"("name", "occurred_at");

-- CreateIndex
CREATE INDEX "product_events_occurred_at_idx" ON "product_events"("occurred_at");

