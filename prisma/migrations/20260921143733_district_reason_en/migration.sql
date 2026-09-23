-- AlterTable
ALTER TABLE "District" ADD COLUMN     "restrictedReasonEn" TEXT;

-- Give the two seeded restricted areas proper bilingual reasons (they were English-only).
UPDATE "District" SET
  "restrictedReason"   = 'دخول مقيّد — مستبعدة من المرحلة التجريبية حتى تُعتمد مع الجهات المختصة',
  "restrictedReasonEn" = 'Restricted access — excluded from the pilot until cleared with the authorities'
WHERE "slug" = 'haram-central' AND "restrictedReasonEn" IS NULL;

UPDATE "District" SET
  "restrictedReason"   = 'قيود موسم الحج — مستبعدة من المرحلة التجريبية',
  "restrictedReasonEn" = 'Hajj-season restrictions — excluded from the pilot'
WHERE "slug" = 'holy-sites' AND "restrictedReasonEn" IS NULL;
