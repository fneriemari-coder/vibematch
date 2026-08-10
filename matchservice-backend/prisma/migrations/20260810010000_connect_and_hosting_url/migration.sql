-- AlterTable
ALTER TABLE "maintenance_agreements" ADD COLUMN     "hosting_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stripe_connect_account_id" TEXT,
ADD COLUMN     "stripe_connect_payouts_enabled" BOOLEAN NOT NULL DEFAULT false;

