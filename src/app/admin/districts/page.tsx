import { DistrictsAdmin } from "@/components/DistrictsAdmin";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";
import { listDistricts } from "@/server/catalogue";

export const generateMetadata = pageMeta("admin.districtsTitle");

export default async function AdminDistricts() {
  const { user } = await requirePage({ path: "/admin/districts", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t } = await getI18n();
  const districts = await listDistricts({ includeInactive: true });
  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.districtsTitle")} sub={t("admin.districtsIntro")} />
      <DistrictsAdmin canEdit={hasRole(user.roles, "ADMIN_OPS")} districts={districts.map((d) => ({ id: d.id, slug: d.slug, nameAr: d.nameAr, nameEn: d.nameEn, restricted: d.restricted, restrictedReason: d.restrictedReason, restrictedReasonEn: d.restrictedReasonEn, gpsRadiusM: d.gpsRadiusM, deliveryStart: d.deliveryStart, deliveryEnd: d.deliveryEnd, fridayBlackoutStart: d.fridayBlackoutStart, fridayBlackoutEnd: d.fridayBlackoutEnd, active: d.active }))} />
    </div>
  );
}
