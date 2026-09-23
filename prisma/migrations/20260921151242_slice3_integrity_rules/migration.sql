-- Slice 3 database guarantees. The application enforces these too; the database is the last line.

-- 1. Orders placed before slice 3 existed get their first allocation, so history is complete.
INSERT INTO "OrderAllocation" ("id", "orderId", "supplierId", "seq", "status", "totalHalalas", "offeredAt", "acceptBy")
SELECT 'alloc_' || o."id", o."id", o."supplierId", 1,
       CASE WHEN o."status" = 'AWAITING_SUPPLIER' THEN 'OFFERED'::"AllocationStatus"
            WHEN o."status" = 'CANCELLED' THEN 'WITHDRAWN'::"AllocationStatus"
            ELSE 'ACCEPTED'::"AllocationStatus" END,
       o."totalHalalas", o."placedAt", o."acceptBy"
FROM "Order" o
WHERE NOT EXISTS (SELECT 1 FROM "OrderAllocation" a WHERE a."orderId" = o."id");

-- 2. Allocations are history: rows may be updated (a response arrives) but never deleted.
CREATE OR REPLACE FUNCTION sabeel_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderAllocation_no_delete" BEFORE DELETE ON "OrderAllocation"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_delete();
CREATE TRIGGER "DeliveryAttempt_no_delete" BEFORE DELETE ON "DeliveryAttempt"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_delete();

-- 3. Proof photos are evidence: never edited, never deleted.
CREATE TRIGGER "ProofPhoto_append_only"
  BEFORE UPDATE OR DELETE ON "ProofPhoto"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_mutation();

-- 4. Proof of delivery is written once. Only the admin-review columns may change afterwards.
CREATE OR REPLACE FUNCTION sabeel_proof_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProofOfDelivery rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'reviewedById' - 'reviewedAt' - 'reviewOutcome' - 'reviewNote')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'reviewedById' - 'reviewedAt' - 'reviewOutcome' - 'reviewNote') THEN
    RAISE EXCEPTION 'ProofOfDelivery evidence cannot be edited' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProofOfDelivery_guard"
  BEFORE UPDATE OR DELETE ON "ProofOfDelivery"
  FOR EACH ROW EXECUTE FUNCTION sabeel_proof_guard();

-- 5. Delivered quantity is set once and can never exceed what was ordered.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_delivered_range"
  CHECK ("deliveredQtyPacks" IS NULL OR ("deliveredQtyPacks" >= 0 AND "deliveredQtyPacks" <= "qtyPacks"));

CREATE OR REPLACE FUNCTION sabeel_delivered_qty_once() RETURNS trigger AS $$
BEGIN
  IF OLD."deliveredQtyPacks" IS NOT NULL AND NEW."deliveredQtyPacks" IS DISTINCT FROM OLD."deliveredQtyPacks" THEN
    RAISE EXCEPTION 'Delivered quantity is already recorded' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderItem_delivered_once"
  BEFORE UPDATE OF "deliveredQtyPacks" ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION sabeel_delivered_qty_once();

-- 6. Sanity checks on numbers a bug could get wrong.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_attempts_range" CHECK ("attempts" >= 0 AND "attempts" <= 5);
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_amounts_nonneg"
  CHECK ("deliveredGoodsHalalas" >= 0 AND "deliveredTotalHalalas" >= 0 AND "deliveredFeeHalalas" >= 0 AND "deliveredPacketEqMilli" >= 0 AND ("distanceM" IS NULL OR "distanceM" >= 0));
ALTER TABLE "OrderAllocation" ADD CONSTRAINT "OrderAllocation_seq_positive" CHECK ("seq" >= 1);

-- 7. A supplier may only have one driver row per person, and a driver row must point at a real supplier member or driver user.
-- (Unique constraint already on (supplierId, userId).)
