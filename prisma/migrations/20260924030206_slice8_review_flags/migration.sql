-- CreateEnum
CREATE TYPE "ReviewFlagStatus" AS ENUM ('OPEN', 'DISMISSED', 'UPHELD');

-- CreateTable
CREATE TABLE "ReviewFlag" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "flaggedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReviewFlagStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewFlag_reviewId_key" ON "ReviewFlag"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewFlag_status_createdAt_idx" ON "ReviewFlag"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewFlag_supplierId_idx" ON "ReviewFlag"("supplierId");

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
