import Link from "next/link";
import { redirect } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { AgreementSign } from "@/components/AgreementSign";
import { Banner, PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { getOwnedSupplier } from "@/server/suppliers";
import { agreementTypeFor, getCurrentTerms, hasAcceptedCurrent } from "@/server/terms";
import { db } from "@/lib/db";

export const generateMetadata = pageMeta("agreement.title");

export default async function AgreementPage() {
  const { user } = await requirePage({ path: "/supplier/agreement", roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();

  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");

  const type = agreementTypeFor(supplier.type);
  const doc = await getCurrentTerms(type);
  const { accepted } = await hasAcceptedCurrent({ userId: user.id, supplierId: supplier.id, type });
  const acceptance = accepted
    ? await db.termsAcceptance.findFirst({ where: { supplierId: supplier.id, termsDocumentId: doc!.id }, orderBy: { acceptedAt: "desc" } })
    : null;

  const company = locale === "ar" ? supplier.legalNameAr : supplier.legalNameEn || supplier.legalNameAr;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeading title={doc ? (locale === "ar" ? doc.titleAr : doc.titleEn) : t("agreement.title")} sub={doc ? t("agreement.version", { version: doc.version }) : undefined} />
      {doc && !doc.legalReviewedAt ? <Banner tone="warn">{t("common.draftBadge")}</Banner> : null}
      <Banner tone="info">{t("agreement.feeNotice")}</Banner>

      {!doc ? (
        <Banner tone="bad">{t("agreement.title")}: —</Banner>
      ) : acceptance ? (
        <div className="space-y-3">
          <Banner tone="ok" role="status">{t("supplier.agreementAccepted", { version: acceptance.version, cert: acceptance.certificateNo })}</Banner>
          <div className="flex gap-2">
            <Link href={`/certificate/${acceptance.certificateNo}`} className={btnCls("primary")}>{t("supplier.agreementView")}</Link>
            <Link href="/supplier" className={btnCls("secondary")}>{t("common.back")}</Link>
          </div>
        </div>
      ) : (
        <AgreementSign
          type={type as "SUPPLIER_AGREEMENT" | "INDEPENDENT_AGREEMENT"}
          companyName={company}
          hasName={!!user.name}
          doc={{ version: doc.version, titleAr: doc.titleAr, titleEn: doc.titleEn, bodyAr: doc.bodyAr, bodyEn: doc.bodyEn, sha256Ar: doc.sha256Ar, sha256En: doc.sha256En }}
        />
      )}
    </div>
  );
}
