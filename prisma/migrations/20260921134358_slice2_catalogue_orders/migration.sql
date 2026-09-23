-- CreateEnum
CREATE TYPE "StockLevel" AS ENUM ('IN_STOCK', 'LIMITED', 'OUT');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DONATION', 'SELF_USE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_SUPPLIER', 'ACCEPTED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED_DRIVER_CONFIRMED', 'ADMIN_REVIEW', 'CONFIRMED_BY_BOTH', 'PAID', 'CLOSED', 'DECLINED', 'EXPIRED', 'ESCALATED', 'FAILED_ATTEMPT', 'DISPUTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Makkah',
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictedReason" TEXT,
    "gpsRadiusM" INTEGER NOT NULL DEFAULT 100,
    "deliveryStart" TEXT NOT NULL DEFAULT '08:00',
    "deliveryEnd" TEXT NOT NULL DEFAULT '22:00',
    "fridayBlackoutStart" TEXT DEFAULT '11:00',
    "fridayBlackoutEnd" TEXT DEFAULT '14:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageZone" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "deliveryFeeHalalas" INTEGER NOT NULL DEFAULT 0,
    "leadTimeHours" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "bottleMl" INTEGER NOT NULL,
    "bottlesPerPack" INTEGER NOT NULL DEFAULT 20,
    "packetEqMilli" INTEGER NOT NULL,
    "priceHalalas" INTEGER NOT NULL,
    "minQtyPacks" INTEGER NOT NULL DEFAULT 1,
    "stock" "StockLevel" NOT NULL DEFAULT 'IN_STOCK',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "nationalAddress" TEXT,
    "landmark" TEXT,
    "accessNotes" TEXT,
    "recipientName" TEXT,
    "recipientMobile" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_SUPPLIER',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "buyerFirstName" TEXT,
    "buyerTier" INTEGER NOT NULL DEFAULT 1,
    "siteId" TEXT,
    "districtId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "nationalAddress" TEXT,
    "landmark" TEXT,
    "accessNotes" TEXT,
    "recipientName" TEXT,
    "recipientMobile" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "acceptBy" TIMESTAMP(3) NOT NULL,
    "goodsHalalas" INTEGER NOT NULL,
    "deliveryHalalas" INTEGER NOT NULL,
    "totalHalalas" INTEGER NOT NULL,
    "vatHalalas" INTEGER NOT NULL,
    "feePerPacketHalalas" INTEGER NOT NULL,
    "packetEqMilliTotal" INTEGER NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT,
    "brandId" TEXT NOT NULL,
    "brandNameAr" TEXT NOT NULL,
    "brandNameEn" TEXT NOT NULL,
    "bottleMl" INTEGER NOT NULL,
    "bottlesPerPack" INTEGER NOT NULL,
    "packetEqMilli" INTEGER NOT NULL,
    "unitPriceHalalas" INTEGER NOT NULL,
    "qtyPacks" INTEGER NOT NULL,
    "lineTotalHalalas" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "District_slug_key" ON "District"("slug");

-- CreateIndex
CREATE INDEX "CoverageZone_districtId_active_idx" ON "CoverageZone"("districtId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageZone_supplierId_districtId_key" ON "CoverageZone"("supplierId", "districtId");

-- CreateIndex
CREATE INDEX "Offer_active_stock_idx" ON "Offer"("active", "stock");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_supplierId_brandId_bottleMl_bottlesPerPack_key" ON "Offer"("supplierId", "brandId", "bottleMl", "bottlesPerPack");

-- CreateIndex
CREATE INDEX "Site_userId_deletedAt_idx" ON "Site"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_supplierId_status_idx" ON "Order"("supplierId", "status");

-- CreateIndex
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_buyerId_idempotencyKey_key" ON "Order"("buyerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoverageZone" ADD CONSTRAINT "CoverageZone_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageZone" ADD CONSTRAINT "CoverageZone_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Slice 2 integrity rules (not expressible in Prisma's schema language) ─────────────

-- Human-readable order numbers: SBL-<year>-<sequence>.
CREATE SEQUENCE IF NOT EXISTS sabeel_order_no_seq START 1;

-- The order timeline is evidence: append-only, like the audit log.
CREATE TRIGGER "OrderEvent_append_only"
  BEFORE UPDATE OR DELETE ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_mutation();

-- Money and quantity sanity: negative or zero values can never be stored.
ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_price_positive" CHECK ("priceHalalas" > 0),
  ADD CONSTRAINT "Offer_pack_positive" CHECK ("bottlesPerPack" > 0 AND "bottleMl" > 0 AND "packetEqMilli" > 0),
  ADD CONSTRAINT "Offer_minqty_positive" CHECK ("minQtyPacks" > 0),
  ADD CONSTRAINT "Offer_validity_order" CHECK ("validTo" IS NULL OR "validFrom" IS NULL OR "validTo" > "validFrom");

ALTER TABLE "CoverageZone"
  ADD CONSTRAINT "CoverageZone_fee_nonneg" CHECK ("deliveryFeeHalalas" >= 0),
  ADD CONSTRAINT "CoverageZone_lead_nonneg" CHECK ("leadTimeHours" >= 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_qty_positive" CHECK ("qtyPacks" > 0),
  ADD CONSTRAINT "OrderItem_price_positive" CHECK ("unitPriceHalalas" > 0),
  ADD CONSTRAINT "OrderItem_line_total" CHECK ("lineTotalHalalas" = "unitPriceHalalas" * "qtyPacks");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_money_consistent" CHECK (
    "goodsHalalas" >= 0 AND "deliveryHalalas" >= 0
    AND "totalHalalas" = "goodsHalalas" + "deliveryHalalas"
    AND "vatHalalas" >= 0 AND "vatHalalas" <= "totalHalalas"
  ),
  ADD CONSTRAINT "Order_window_order" CHECK ("windowEnd" > "windowStart"),
  ADD CONSTRAINT "Order_recipient_mobile_format" CHECK ("recipientMobile" IS NULL OR "recipientMobile" ~ '^\+9665[0-9]{8}$');

ALTER TABLE "Site"
  ADD CONSTRAINT "Site_recipient_mobile_format" CHECK ("recipientMobile" IS NULL OR "recipientMobile" ~ '^\+9665[0-9]{8}$'),
  ADD CONSTRAINT "Site_lat_range" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);

ALTER TABLE "District"
  ADD CONSTRAINT "District_hours_format" CHECK (
    "deliveryStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "deliveryEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "deliveryEnd" > "deliveryStart"
  ),
  ADD CONSTRAINT "District_radius_positive" CHECK ("gpsRadiusM" BETWEEN 20 AND 2000);
