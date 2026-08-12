-- CreateEnum
CREATE TYPE "GrowthPillar" AS ENUM ('VENDAS', 'GESTAO', 'TECNOLOGIA', 'FINANCAS');

-- CreateEnum
CREATE TYPE "MentorshipBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED');

-- AlterTable
ALTER TABLE "business_courses" ADD COLUMN     "is_ai_generated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "growth_diagnostics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "score_vendas" INTEGER NOT NULL,
    "score_gestao" INTEGER NOT NULL,
    "score_tecnologia" INTEGER NOT NULL,
    "score_financas" INTEGER NOT NULL,
    "weakest_pillar" "GrowthPillar" NOT NULL,
    "summary" TEXT NOT NULL,
    "recommendations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentorship_offerings" (
    "id" TEXT NOT NULL,
    "mentor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentorship_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentorship_slots" (
    "id" TEXT NOT NULL,
    "offering_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "booked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentorship_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentorship_bookings" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "offering_id" TEXT NOT NULL,
    "mentee_id" TEXT NOT NULL,
    "status" "MentorshipBookingStatus" NOT NULL DEFAULT 'PENDING',
    "price_paid" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "meeting_url" TEXT,
    "stripe_checkout_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentorship_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_diagnostics_user_id_created_at_idx" ON "growth_diagnostics"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "mentorship_offerings_mentor_id_idx" ON "mentorship_offerings"("mentor_id");

-- CreateIndex
CREATE INDEX "mentorship_slots_starts_at_booked_idx" ON "mentorship_slots"("starts_at", "booked");

-- CreateIndex
CREATE UNIQUE INDEX "mentorship_slots_offering_id_starts_at_key" ON "mentorship_slots"("offering_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "mentorship_bookings_slot_id_key" ON "mentorship_bookings"("slot_id");

-- CreateIndex
CREATE INDEX "mentorship_bookings_mentee_id_created_at_idx" ON "mentorship_bookings"("mentee_id", "created_at");

-- CreateIndex
CREATE INDEX "mentorship_bookings_offering_id_idx" ON "mentorship_bookings"("offering_id");

-- AddForeignKey
ALTER TABLE "growth_diagnostics" ADD CONSTRAINT "growth_diagnostics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship_offerings" ADD CONSTRAINT "mentorship_offerings_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship_slots" ADD CONSTRAINT "mentorship_slots_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "mentorship_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship_bookings" ADD CONSTRAINT "mentorship_bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "mentorship_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship_bookings" ADD CONSTRAINT "mentorship_bookings_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "mentorship_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentorship_bookings" ADD CONSTRAINT "mentorship_bookings_mentee_id_fkey" FOREIGN KEY ("mentee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data migration: move the AI-course marker out of `skills_taught`.
--
-- AiFactoryService marked a generated course by pushing the literal string
-- 'AI_GENERATED' into `skills_taught` — the one array the platform matches
-- providers (UserProfile.skills) and Discovery Feed posts (PostTag.tagName)
-- against. A marker word sitting in that array is a fake skill: it can be
-- searched for, it can be matched on, and it can never match anyone.
--
-- Both statements are idempotent (re-running them is a no-op), which is what
-- lets this live in the same migration as the column that enables it.
-- ---------------------------------------------------------------------------

UPDATE "business_courses"
SET "is_ai_generated" = true
WHERE 'AI_GENERATED' = ANY("skills_taught");

UPDATE "business_courses"
SET "skills_taught" = ARRAY_REMOVE("skills_taught", 'AI_GENERATED')
WHERE 'AI_GENERATED' = ANY("skills_taught");
