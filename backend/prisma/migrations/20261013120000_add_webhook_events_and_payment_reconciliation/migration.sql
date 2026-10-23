-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reconciliationReason" TEXT;

-- CreateIndex
CREATE INDEX "Payment_reconciliationRequired_idx" ON "Payment"("reconciliationRequired");

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_type_idx" ON "ProcessedWebhookEvent"("type");
