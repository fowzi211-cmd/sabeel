import { pageMeta } from "@/i18n/meta";
import { BrandsManager } from "@/components/BrandsManager";
import { Banner, PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";
import { listBrands } from "@/server/brands";

export const generateMetadata = pageMeta("admin.brandsTitle");

export default async function AdminBrands() {
  const { user } = await requirePage({ path: "/admin/brands", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t } = await getI18n();
  const brands = await listBrands();
  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.brandsTitle")} sub={t("admin.brandsIntro")} />
      {brands.some((b) => b.sfdaRef.startsWith("DEMO-")) ? <Banner tone="warn">DEMO brands (fictional) are present — development data only.</Banner> : null}
      <BrandsManager brands={brands.map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, sfdaRef: b.sfdaRef, status: b.status, notes: b.notes }))} canEdit={hasRole(user.roles, "ADMIN_OPS")} />
    </div>
  );
}
