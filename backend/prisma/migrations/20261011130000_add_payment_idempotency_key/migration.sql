-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

-- Backfill existing payment records so the new required column has a unique,
-- non-null value per order before we enforce both NOT NULL and the compound
-- unique constraint. The payment's own id is unique and non-null, so it is a
-- safe idempotency key for any pre-existing rows.
UPDATE "Payment"
SET "idempotencyKey" = "id"
WHERE "idempotencyKey" IS NULL;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- DropIndex
DROP INDEX "Payment_orderId_key";

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_idempotencyKey_key" ON "Payment"("orderId", "idempotencyKey");