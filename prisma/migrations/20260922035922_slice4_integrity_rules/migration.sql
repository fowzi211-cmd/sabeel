-- Slice 4 database guarantees. The application enforces these too; the database is the last line.

-- 1. Payment transaction numbers, human-readable and unique: SBL-PAY-2026-000123.
CREATE SEQUENCE IF NOT EXISTS sabeel_payment_no_seq START 1;

-- 2. Only one open dispute per order at a time (the app checks first; this is the backstop).
CREATE UNIQUE INDEX "Dispute_one_open_per_order" ON "Dispute" ("orderId") WHERE "status" = 'OPEN';

-- 3. Amounts and dates must make sense.
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_amount_positive" CHECK ("amountHalalas" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_adjustedTotal_range"
  CHECK ("adjustedTotalHalalas" IS NULL OR ("adjustedTotalHalalas" >= 0 AND "adjustedTotalHalalas" <= "totalHalalas"));

-- 4. A resolved dispute must record who resolved it and what was decided; an open one must not.
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolution_consistent" CHECK (
  ("status" = 'OPEN' AND "outcome" IS NULL AND "resolvedById" IS NULL AND "resolvedAt" IS NULL)
  OR
  ("status" = 'RESOLVED' AND "outcome" IS NOT NULL AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL)
);

-- 5. A NON_PAYMENT dispute is the supplier's (or admin's) complaint that they were not paid; every
--    other category is the buyer's (or admin's) complaint about the delivery itself.
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_category_opener_consistent" CHECK (
  ("category" = 'NON_PAYMENT' AND "openedBy" IN ('SUPPLIER', 'ADMIN'))
  OR
  ("category" != 'NON_PAYMENT' AND "openedBy" IN ('BUYER', 'ADMIN'))
);

-- 6. Once a payment is marked received, the record is done: reopening it means a new dispute, not an edit.
--    (The application never updates a RECEIVED or VOID row; this is the backstop.)
CREATE OR REPLACE FUNCTION sabeel_payment_settled_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('RECEIVED', 'VOID') AND NEW."status" != OLD."status" THEN
    RAISE EXCEPTION 'A settled PaymentRecord cannot change status again' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentRecord_settled_guard"
  BEFORE UPDATE ON "PaymentRecord"
  FOR EACH ROW EXECUTE FUNCTION sabeel_payment_settled_guard();
