-- DropIndex
DROP INDEX "issued_certificates_user_id_course_id_idx";

-- AlterTable
ALTER TABLE "escrow_projects" ADD COLUMN     "stripe_payment_intent_id" TEXT;

-- CreateTable
CREATE TABLE "processed_stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processed_stripe_events_processed_at_idx" ON "processed_stripe_events"("processed_at");

-- CreateIndex
CREATE INDEX "bnpl_installments_stripe_invoice_id_idx" ON "bnpl_installments"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "escrow_projects_client_id_idx" ON "escrow_projects"("client_id");

-- CreateIndex
CREATE INDEX "escrow_projects_provider_id_idx" ON "escrow_projects"("provider_id");

-- CreateIndex
CREATE INDEX "escrow_projects_status_idx" ON "escrow_projects"("status");

-- CreateIndex
CREATE UNIQUE INDEX "issued_certificates_user_id_course_id_key" ON "issued_certificates"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "maintenance_agreements_stripe_subscription_id_idx" ON "maintenance_agreements"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "matches_user_two_id_idx" ON "matches"("user_two_id");

-- CreateIndex
CREATE INDEX "subscriptions_stripe_customer_id_idx" ON "subscriptions"("stripe_customer_id");

-- AddForeignKey
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "business_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Spatial index for LOCAL mode. Prisma cannot express an expression index, so
-- it is written by hand here.
--
-- Every LOCAL swipe (swipes.service.ts) and every LOCAL feed page
-- (feed.service.ts) filters with ST_DWithin over ST_MakePoint(longitude,
-- latitude)::geography. The only index that existed was a btree on the two
-- float columns, which cannot serve that predicate — so each query was a
-- sequential scan of user_profiles casting every row to geography. This is the
-- single largest query cost in the app and it grows linearly with signups.
--
-- The expression below must stay byte-for-byte identical to the one in those
-- queries; Postgres will not use the index otherwise.
CREATE INDEX IF NOT EXISTS "user_profiles_geography_idx"
  ON "user_profiles"
  USING GIST ((ST_MakePoint(longitude, latitude)::geography));
