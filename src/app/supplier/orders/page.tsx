import Link from "next/link";
import { redirect } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { Card, Chip, PageHeading } from "@/components/ui";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { db } from "@/lib/db";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { listSupplierOrders, supplierOrderView } from "@/server/orders";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("sorders.title");

/** Tabs from the design pack (S25): new · active · delivered · closed. */
const TABS: Record<string, OrderStatus[]> = {
  new: ["AWAITING_SUPPLIER"],
  active: ["ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT"],
  delivered: ["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW", "CONFIRMED_BY_BOTH", "DISPUTED"],
  closed: ["PAID", "CLOSED", "CANCELLED"],
};

export default async function SupplierOrders({ searchParams }: PageProps<"/supplier/orders">) {
  const { user } = await requirePage({ path: "/supplier/orders", roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = raw && raw in TABS ? raw : "";

  const [all, districts] = await Promise.all([listSupplierOrders(supplier.id), db.district.findMany()]);
  const dName = new Map(districts.map((d) => [d.id, locale === "ar" ? d.nameAr : d.nameEn]));
  const orders = all.filter((o) => !tab || TABS[tab].includes(o.status)).map(supplierOrderView);
  const counts = Object.fromEntries(Object.entries(TABS).map(([k, v]) => [k, all.filter((o) => v.includes(o.status)).length]));

  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-white text-aqua-700 ring-1 ring-line hover:bg-aqua-100"}`;

  return (
    <div className="mx-auto max-w-3xl">
      <SupplierSubnav />
      <PageHeading title={t("sorders.title")} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/supplier/orders" className={chip(!tab)}>{t("admin.filterAll")}</Link>
        {Object.keys(TABS).map((k) => (
          <Link key={k} href={`/supplier/orders?tab=${k}`} className={chip(tab === k)}>{t(`sorders.tabs.${k}`)} ({counts[k]})</Link>
        ))}
      </div>
      {orders.length === 0 ? <Card><p className="text-muted">{t("sorders.empty")}</p></Card> : null}
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/supplier/orders/${o.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-aqua-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ltr-iso font-mono font-semibold">{o.orderNo}</span>
                <Chip tone={o.status === "AWAITING_SUPPLIER" || o.status === "FAILED_ATTEMPT" ? "warn" : o.status === "CANCELLED" ? "bad" : "info"}>{t(`orders.status.${o.status}`)}</Chip>
              </div>
              <div className="mt-1 text-sm">
                {o.anonymous || !o.donor ? t("sorders.anonymousDonor") : t("sorders.donor", { name: o.donor })} · {dName.get(o.districtId)}
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-sm text-muted">
                <span>{o.items.map((i) => `${locale === "ar" ? i.brandNameAr : i.brandNameEn} × ${i.qtyPacks}`).join("، ")}</span>
                <span>{t("sorders.youKeep")}: <span className="font-semibold text-ink">{formatSar(o.feePreview.keep, locale)}</span></span>
              </div>
              <div className="mt-1 text-xs text-muted">{t("orders.window")}: {fmtWhen(o.window.start, locale)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
