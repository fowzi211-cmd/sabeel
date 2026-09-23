-- CreateEnum
CREATE TYPE "ConfirmMethod" AS ENUM ('BUYER', 'ADMIN_SILENCE', 'ADMIN_DISPUTE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_DUE', 'DUE', 'BUYER_MARKED_PAID', 'RECEIVED', 'OVERDUE', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('NOT_DELIVERED', 'SHORT', 'WRONG_BRAND', 'DAMAGED', 'LATE', 'NON_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeOpenedBy" AS ENUM ('BUYER', 'SUPPLIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('REDELIVER', 'PRICE_ADJUSTMENT', 'CANCEL', 'DISMISS', 'PAYMENT_RECEIVED', 'PAYMENT_STILL_DUE', 'PAYMENT_VOID');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adjustedTotalHalalas" INTEGER,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "confirmMethod" "ConfirmMethod",
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "paidOnTimeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "transactionNo" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DUE',
    "amountHalalas" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "bankReference" TEXT,
    "receiptFileKey" TEXT,
    "receiptMime" TEXT,
    "markedPaidAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "notReceivedNote" TEXT,
    "notReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "openedBy" "DisputeOpenedBy" NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL,
    "outcome" "DisputeOutcome",
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_transactionNo_key" ON "PaymentRecord"("transactionNo");

-- CreateIndex
CREATE INDEX "PaymentRecord_status_dueAt_idx" ON "PaymentRecord"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Dispute_orderId_status_idx" ON "Dispute"("orderId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_category_idx" ON "Dispute"("status", "category");

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
