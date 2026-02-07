-- Add autopilot controls to maintenance requests
ALTER TABLE "MaintenanceRequest"
    ADD COLUMN "autopilotEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "autopilotStatus" TEXT,
    ADD COLUMN "autopilotLog" JSONB;
