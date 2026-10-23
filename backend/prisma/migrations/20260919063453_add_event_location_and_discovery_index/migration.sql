-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "location" TEXT;

-- CreateIndex
CREATE INDEX "Event_status_startDate_idx" ON "Event"("status", "startDate");
