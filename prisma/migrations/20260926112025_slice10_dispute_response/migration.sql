-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "responseDueAt" TIMESTAMP(3),
ADD COLUMN     "responseFileKey" TEXT,
ADD COLUMN     "responseMime" TEXT,
ADD COLUMN     "supplierRespondedAt" TIMESTAMP(3),
ADD COLUMN     "supplierRespondedById" TEXT,
ADD COLUMN     "supplierResponse" TEXT;

-- CreateIndex
CREATE INDEX "Dispute_responseDueAt_idx" ON "Dispute"("responseDueAt");
