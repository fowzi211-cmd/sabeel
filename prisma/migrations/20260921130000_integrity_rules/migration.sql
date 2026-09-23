-- Integrity rules that Prisma's schema language cannot express (design pack §5.3).

-- 1. Evidence tables are append-only: acceptance records and the audit log can never be
--    updated or deleted, not even by application bugs or a compromised admin account.
CREATE OR REPLACE FUNCTION sabeel_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% is not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TermsAcceptance_append_only"
  BEFORE UPDATE OR DELETE ON "TermsAcceptance"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_mutation();

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION sabeel_forbid_mutation();

-- 2. A published agreement's text, hashes, version and type are immutable. Only the
--    "legal review completed" and "superseded" markers may change later.
CREATE OR REPLACE FUNCTION sabeel_protect_terms() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TermsDocument rows cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."titleAr" IS DISTINCT FROM OLD."titleAr"
     OR NEW."titleEn" IS DISTINCT FROM OLD."titleEn"
     OR NEW."bodyAr" IS DISTINCT FROM OLD."bodyAr"
     OR NEW."bodyEn" IS DISTINCT FROM OLD."bodyEn"
     OR NEW."sha256Ar" IS DISTINCT FROM OLD."sha256Ar"
     OR NEW."sha256En" IS DISTINCT FROM OLD."sha256En"
     OR NEW."noticeDays" IS DISTINCT FROM OLD."noticeDays"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION 'Published agreement text is immutable; publish a new version instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TermsDocument_protect"
  BEFORE UPDATE OR DELETE ON "TermsDocument"
  FOR EACH ROW EXECUTE FUNCTION sabeel_protect_terms();

-- 3. PostgreSQL treats NULLs as distinct in unique indexes, so a buyer (no supplier)
--    could otherwise accept the same document twice.
CREATE UNIQUE INDEX "TermsAcceptance_user_doc_nosupplier_key"
  ON "TermsAcceptance" ("userId", "termsDocumentId")
  WHERE "supplierId" IS NULL;

-- 4. At most one ACTIVE bank account per supplier; buyers pay exactly one account.
CREATE UNIQUE INDEX "BankAccount_one_active_per_supplier"
  ON "BankAccount" ("supplierId")
  WHERE "status" = 'ACTIVE';

-- 5. Format guards (defence in depth — the application validates first).
ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_iban_sa_format" CHECK ("iban" ~ '^SA[0-9]{22}$');

ALTER TABLE "User"
  ADD CONSTRAINT "User_mobile_sa_format" CHECK ("mobile" ~ '^\+9665[0-9]{8}$');

ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_ceiling_nonnegative" CHECK ("creditCeilingHalalas" >= 0);

-- 6. Human-readable certificate numbers (SBL-AGR-<year>-<sequence>).
CREATE SEQUENCE IF NOT EXISTS sabeel_acceptance_no_seq START 1;
