-- AlterTable
ALTER TABLE "MaintenanceRequest" ADD COLUMN     "aiDraft" JSONB,
ADD COLUMN     "chatLog" JSONB,
ADD COLUMN     "landlordReply" TEXT;
