import { redirect } from "next/navigation";
import { Banner, PageHeading } from "@/components/ui";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { ZonesManager } from "@/components/ZonesManager";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { coverageOverview } from "@/server/catalogue";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("zones.title");

export default async function ZonesPage() {
  const { user } = await requirePage({ path: "/supplier/zones", roles: ["SUPPLIER_ADMIN"] });
  const { t } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const canEdit = supplier.status === "ACTIVE";
  const overview = await coverageOverview(supplier.id);

  return (
    <div className="mx-auto max-w-3xl">
      <SupplierSubnav />
      <PageHeading title={t("zones.title")} sub={t("zones.intro")} />
      {!canEdit ? <div className="mb-4"><Banner tone="warn">{t("catalogue.needsActive")}</Banner></div> : null}
      <ZonesManager
        canEdit={canEdit}
        districts={overview.map(({ district, zone }) => ({
          id: district.id, nameAr: district.nameAr, nameEn: district.nameEn, restricted: district.restricted, restrictedReason: district.restrictedReason, restrictedReasonEn: district.restrictedReasonEn,
          zone: zone && { deliveryFeeHalalas: zone.deliveryFeeHalalas, leadTimeHours: zone.leadTimeHours, active: zone.active },
        }))}
      />
    </div>
  );
}
