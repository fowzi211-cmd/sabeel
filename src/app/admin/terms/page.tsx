import { pageMeta } from "@/i18n/meta";
import { TermsAdmin } from "@/components/TermsAdmin";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";

export const generateMetadata = pageMeta("admin.termsTitle");

export default async function AdminTerms() {
  const { user } = await requirePage({ path: "/admin/terms", roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] });
  const { t } = await getI18n();
  const docs = await db.termsDocument.findMany({
    orderBy: [{ type: "asc" }, { effectiveFrom: "desc" }],
    select: { id: true, type: true, version: true, titleAr: true, titleEn: true, effectiveFrom: true, sha256Ar: true, legalReviewedAt: true },
  });
  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.termsTitle")} sub={t("admin.termsIntro")} />
      <TermsAdmin
        canPublish={user.roles.includes("SUPER_ADMIN")}
        rows={docs.map((d) => ({ ...d, effectiveFrom: d.effectiveFrom.toISOString(), legalReviewedAt: d.legalReviewedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
