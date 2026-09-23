import { redirect } from "next/navigation";
import { Banner, PageHeading } from "@/components/ui";
import { CatalogueManager } from "@/components/CatalogueManager";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";
import { currentFeePerPacket, listOffers } from "@/server/catalogue";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("catalogue.title");

export default async function CataloguePage() {
  const { user } = await requirePage({ path: "/supplier/catalogue", roles: ["SUPPLIER_ADMIN"] });
  const { t } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");

  const canEdit = supplier.status === "ACTIVE";
  const [offers, brands, fee] = await Promise.all([
    listOffers(supplier.id),
    db.brand.findMany({ where: { status: "ACTIVE" }, orderBy: { nameEn: "asc" }, select: { id: true, nameAr: true, nameEn: true } }),
    currentFeePerPacket(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <SupplierSubnav />
      <PageHeading title={t("catalogue.title")} sub={t("catalogue.intro")} />
      {!canEdit ? <div className="mb-4"><Banner tone="warn">{t("catalogue.needsActive")}</Banner></div> : null}
      <CatalogueManager offers={offers.map((o) => ({ id: o.id, bottleMl: o.bottleMl, bottlesPerPack: o.bottlesPerPack, packetEqMilli: o.packetEqMilli, priceHalalas: o.priceHalalas, minQtyPacks: o.minQtyPacks, stock: o.stock, active: o.active, brand: o.brand }))} brands={brands} feePerPacket={fee} canEdit={canEdit} />
    </div>
  );
}
