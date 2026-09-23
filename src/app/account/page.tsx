import Link from "next/link";
import { pageMeta } from "@/i18n/meta";
import { BuyerTermsCard } from "@/components/BuyerTermsCard";
import { ProfileForm } from "@/components/ProfileForm";
import { Banner, Card, PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage, safeNext } from "@/lib/guards";
import { getOwnedSupplier } from "@/server/suppliers";
import { hasAcceptedCurrent } from "@/server/terms";

export const generateMetadata = pageMeta("account.title");

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const sp = await searchParams;
  const { user } = await requirePage({ path: "/account" });
  const { t } = await getI18n();
  const next = safeNext(sp.next, "/account");

  const [terms, supplier] = await Promise.all([
    hasAcceptedCurrent({ userId: user.id, supplierId: null, type: "BUYER_TERMS" }),
    getOwnedSupplier(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title={t("account.title")} />
      {!user.name ? <Banner tone="warn">{t("account.needName")}</Banner> : null}

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("account.profile")}</h2>
        <ProfileForm mobile={user.mobile} initialName={user.name ?? ""} initialEmail={user.email ?? ""} next={next} termsAccepted={!terms.doc || terms.accepted} />
      </Card>

      {terms.doc ? (
        <BuyerTermsCard
          hasName={!!user.name}
          next={next}
          accepted={terms.accepted}
          doc={{
            version: terms.doc.version,
            titleAr: terms.doc.titleAr,
            titleEn: terms.doc.titleEn,
            bodyAr: terms.doc.bodyAr,
            bodyEn: terms.doc.bodyEn,
            legalReviewed: !!terms.doc.legalReviewedAt,
          }}
        />
      ) : null}

      <Card tint>
        <h2 className="text-lg font-bold">{t("account.becomeSupplier")}</h2>
        <p className="mt-1 text-muted">{t("account.becomeSupplierText")}</p>
        <div className="mt-3">
          <Link href={supplier ? "/supplier" : "/supplier/apply"} className={btnCls("secondary")}>
            {supplier ? t("account.mySupplier") : t("account.becomeSupplier")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
