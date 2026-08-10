-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'MASTERMIND_REVENUE';

-- CreateTable
CREATE TABLE "mastermind_bookings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "price_paid" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastermind_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mastermind_bookings_session_id_user_id_key" ON "mastermind_bookings"("session_id", "user_id");

-- AddForeignKey
ALTER TABLE "mastermind_bookings" ADD CONSTRAINT "mastermind_bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_mastermind_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastermind_bookings" ADD CONSTRAINT "mastermind_bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

