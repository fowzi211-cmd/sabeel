-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('IN_PROGRESS', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('BRAND_LABEL', 'DELIVERED_GOODS', 'SITE', 'FAILURE');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'DELIVERY';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "deliveredQtyPacks" INTEGER;

-- CreateTable
CREATE TABLE "OrderAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'OFFERED',
    "totalHalalas" INTEGER NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptBy" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "declineReason" TEXT,
    "declineNote" TEXT,

    CONSTRAINT "OrderAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehiclePlate" TEXT,
    "licenceNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "pinLat" DOUBLE PRECISION,
    "pinLng" DOUBLE PRECISION,
    "pinNote" TEXT,
    "pinProposedAt" TIMESTAMP(3),
    "otpSentAt" TIMESTAMP(3),
    "otpVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "driverId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "outcome" "AttemptOutcome" NOT NULL DEFAULT 'IN_PROGRESS',
    "failReason" TEXT,
    "failNote" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPhoto" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'CAMERA',
    "flags" TEXT[],

    CONSTRAINT "ProofPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "distanceM" INTEGER,
    "radiusM" INTEGER NOT NULL,
    "radiusOk" BOOLEAN NOT NULL,
    "outsideReason" TEXT,
    "brandPhotoOk" BOOLEAN NOT NULL,
    "recipientOtpOk" BOOLEAN NOT NULL,
    "otpBypassReason" TEXT,
    "batchNote" TEXT,
    "notes" TEXT,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "deliveredGoodsHalalas" INTEGER NOT NULL,
    "deliveredTotalHalalas" INTEGER NOT NULL,
    "deliveredVatHalalas" INTEGER NOT NULL,
    "deliveredPacketEqMilli" INTEGER NOT NULL,
    "deliveredFeeHalalas" INTEGER NOT NULL,
    "confirmedAtDevice" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedOffline" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT[],
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "reviewReasons" TEXT[],
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewOutcome" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderAllocation_supplierId_status_idx" ON "OrderAllocation"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAllocation_orderId_supplierId_key" ON "OrderAllocation"("orderId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAllocation_orderId_seq_key" ON "OrderAllocation"("orderId", "seq");

-- CreateIndex
CREATE INDEX "Driver_userId_active_idx" ON "Driver"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_supplierId_userId_key" ON "Driver"("supplierId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_driverId_status_idx" ON "Delivery"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_n_key" ON "DeliveryAttempt"("deliveryId", "n");

-- CreateIndex
CREATE INDEX "ProofPhoto_sha256_idx" ON "ProofPhoto"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPhoto_deliveryId_clientId_key" ON "ProofPhoto"("deliveryId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_deliveryId_key" ON "ProofOfDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "ProofOfDelivery_reviewRequired_reviewedAt_idx" ON "ProofOfDelivery"("reviewRequired", "reviewedAt");

-- AddForeignKey
ALTER TABLE "OrderAllocation" ADD CONSTRAINT "OrderAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAllocation" ADD CONSTRAINT "OrderAllocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPhoto" ADD CONSTRAINT "ProofPhoto_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
