import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { Chip, PageHeading, Table, btnCls, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { adminOrderView, listAllOrders } from "@/server/orders";

export const generateMetadata = pageMeta("admin.ordersTitle");
const FILTERS: OrderStatus[] = ["AWAITING_SUPPLIER", "ESCALATED", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED_ATTEMPT", "DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW", "DISPUTED", "CONFIRMED_BY_BOTH", "PAID", "CLOSED", "CANCELLED"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function AdminOrders({ searchParams }: PageProps<"/admin/orders">) {
  await requirePage({ path: "/admin/orders", roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] });
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const raw = one(sp.status);
  const attention = one(sp.attention) === "1";
  const status = attention ? undefined : FILTERS.find((s) => s === raw);
  const cursor = one(sp.cursor);
  const { items, nextCursor } = await listAllOrders({ status, attention }, { cursor });
  const orders = items.map(adminOrderView);
  const qs = (extra: string) => [status ? `status=${status}` : "", attention ? "attention=1" : "", extra].filter(Boolean).join("&");

  const tab = (active: boolean) => `rounded-full px-3 py-1 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-white text-aqua-700 ring-1 ring-line hover:bg-aqua-100"}`;

  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.ordersTitle")} />
      <div className="flex flex-wrap gap-1.5">
        <Link href="/admin/orders" className={tab(!status && !attention)}>{t("admin.filterAll")}</Link>
        <Link href="/admin/orders?attention=1" className={tab(attention)}>{t("adminOps.attention")}</Link>
        {FILTERS.map((s) => <Link key={s} href={`/admin/orders?status=${s}`} className={tab(status === s)}>{t(`orders.status.${s}`)}</Link>)}
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("admin.orderNo")}</th>
            <th className={th}>{t("admin.buyer")}</th>
            <th className={th}>{t("admin.supplierCol")}</th>
            <th className={th}>{t("admin.orderTotal")}</th>
            <th className={th}>{t("common.status")}</th>
            <th className={th}>{t("orders.placedAt")}</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? <tr><td className={td} colSpan={7}>{t("admin.noOrders")}</td></tr> : null}
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={td}><span className="ltr-iso font-mono">{o.orderNo}</span></td>
              <td className={td}>{o.buyer.name ?? "—"}</td>
              <td className={td}>{locale === "ar" ? o.supplier.nameAr : o.supplier.nameEn}</td>
              <td className={td}>{formatSar(o.totalHalalas, locale)}</td>
              <td className={td}>
                <Chip tone={o.status === "CANCELLED" ? "bad" : ["AWAITING_SUPPLIER", "ESCALATED", "FAILED_ATTEMPT", "ADMIN_REVIEW", "DISPUTED"].includes(o.status) ? "warn" : "info"}>{t(`orders.status.${o.status}`)}</Chip>
                {o.proof?.reviewRequired && !o.proof.reviewedAt ? <> <Chip tone="info">{t("fulfil.reviewPending")}</Chip></> : null}
                {o.payment && (o.payment.status === "OVERDUE" || o.payment.status === "DISPUTED") ? <> <Chip tone="bad">{t(`payment.status.${o.payment.status}`)}</Chip></> : null}
              </td>
              <td className={td}>{fmtWhen(o.placedAt, locale)}</td>
              <td className={td}><Link href={`/admin/orders/${o.id}`} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.review")}</Link></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {nextCursor ? <Link href={`/admin/orders?${qs(`cursor=${nextCursor}`)}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
