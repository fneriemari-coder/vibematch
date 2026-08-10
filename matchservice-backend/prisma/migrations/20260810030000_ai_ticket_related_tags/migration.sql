-- AlterTable
ALTER TABLE "ai_ticket_monitors" ADD COLUMN     "related_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

