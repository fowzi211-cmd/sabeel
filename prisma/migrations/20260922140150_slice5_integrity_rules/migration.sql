-- Slice 5 database guarantees. The application enforces these too; the database is the last line.

-- 1. Fee invoice numbers, human-readable and unique: SBL-INV-2026-000045.
CREATE SEQUENCE IF NOT EXISTS sabeel_invoice_no_seq START 1;

-- 2. A settled fee invoice (PAID) cannot change status again — same protection as PaymentRecord.
CREATE OR REPLACE FUNCTION sabeel_invoice_settled_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PAID' AND NEW."status" != 'PAID' THEN
    RAISE EXCEPTION 'A paid FeeInvoice cannot change status again' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FeeInvoice_settled_guard"
  BEFORE UPDATE ON "FeeInvoice"
  FOR EACH ROW EXECUTE FUNCTION sabeel_invoice_settled_guard();

-- 3. A FeeAccrual is the platform's own record of what is owed: nothing about it may change after the
--    fact except linking it to an invoice once, and it can never be deleted.
CREATE OR REPLACE FUNCTION sabeel_accrual_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FeeAccrual rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."invoiceId" IS NOT NULL AND NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" THEN
    RAISE EXCEPTION 'A FeeAccrual already on an invoice cannot be moved to another' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'invoiceId') IS DISTINCT FROM (to_jsonb(OLD) - 'invoiceId') THEN
    RAISE EXCEPTION 'A FeeAccrual cannot be edited, only linked to an invoice' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FeeAccrual_guard"
  BEFORE UPDATE OR DELETE ON "FeeAccrual"
  FOR EACH ROW EXECUTE FUNCTION sabeel_accrual_guard();

-- 4. A review is evidence: the buyer's own words are write-once. Only the admin-moderation columns,
--    and once the supplier replies, may change afterwards.
CREATE OR REPLACE FUNCTION sabeel_review_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'removedById' - 'removedAt' - 'removeReason')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'removedById' - 'removedAt' - 'removeReason') THEN
    RAISE EXCEPTION 'A review cannot be edited, only removed by an admin' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Review_guard"
  BEFORE UPDATE OR DELETE ON "Review"
  FOR EACH ROW EXECUTE FUNCTION sabeel_review_guard();

-- 5. A supplier's one reply cannot be edited or deleted through the app.
CREATE TRIGGER "ReviewReply_append_only"
  BEFORE UPDATE OR DELETE ON "ReviewReply"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_mutation();

-- 6. Sanity checks on numbers a bug could get wrong.
ALTER TABLE "FeeAccrual" ADD CONSTRAINT "FeeAccrual_amounts_nonneg" CHECK ("amountHalalas" >= 0 AND "vatHalalas" >= 0 AND "packetEqMilli" >= 0);
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_amounts_nonneg" CHECK ("subtotalHalalas" >= 0 AND "vatHalalas" >= 0 AND "totalHalalas" >= 0 AND "periodEnd" > "periodStart");
ALTER TABLE "Review" ADD CONSTRAINT "Review_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT "Review_category_range" CHECK (
  ("timeliness" IS NULL OR "timeliness" BETWEEN 1 AND 5) AND
  ("asOrdered" IS NULL OR "asOrdered" BETWEEN 1 AND 5) AND
  ("packaging" IS NULL OR "packaging" BETWEEN 1 AND 5) AND
  ("driverConduct" IS NULL OR "driverConduct" BETWEEN 1 AND 5) AND
  ("value" IS NULL OR "value" BETWEEN 1 AND 5)
);
