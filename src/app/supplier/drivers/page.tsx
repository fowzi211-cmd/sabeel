import { redirect } from "next/navigation";
import { DriversManager } from "@/components/DriversManager";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { getEnv } from "@/lib/env";
import { requirePage } from "@/lib/guards";
import { listDrivers } from "@/server/drivers";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("drivers.title");

export default async function DriversPage() {
  const { user } = await requirePage({ path: "/supplier/drivers", roles: ["SUPPLIER_ADMIN"] });
  const { t } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const drivers = (await listDrivers(supplier.id)).map((d) => ({ ...d, isYou: d.mobile === user.mobile }));

  return (
    <div className="mx-auto max-w-3xl">
      <SupplierSubnav />
      <PageHeading title={t("drivers.title")} />
      <DriversManager drivers={drivers} canEdit={supplier.status === "ACTIVE"} hasSelf={drivers.some((d) => d.isYou)} appUrl={getEnv().APP_ORIGIN} />
    </div>
  );
}
