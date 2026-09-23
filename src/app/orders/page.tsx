import Link from "next/link";
import { Card, Chip, PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { buyerOrderView, listBuyerOrders } from "@/server/orders";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export const generateMetadata = pageMeta("orders.title");

const tone = (s: string) =>
  s === "CANCELLED" || s === "DECLINED" || s === "EXPIRED" || s === "DISPUTED" ? "bad"
  : s === "PAID" || s === "CLOSED" ? "ok"
  : s === "AWAITING_SUPPLIER" || s === "ESCALATED" || s === "FAILED_ATTEMPT" || s === "ADMIN_REVIEW" ? "warn"
  : "info";

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { user } = await requirePage({ path: "/orders" });
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const cursor = one(sp.cursor);
  const { items, nextCursor } = await listBuyerOrders(user.id, { cursor });
  const orders = items.map((o) => buyerOrderView(o));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeading title={t("orders.title")} actions={<Link href="/order" className={btnCls("primary")}>{t("orders.newOrder")}</Link>} />
      {orders.length === 0 ? <Card><p className="text-muted">{t("orders.empty")}</p></Card> : null}
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-aqua-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ltr-iso font-mono font-semibold">{o.orderNo}</span>
                <span className="flex gap-1.5">
                  <Chip tone={tone(o.status)}>{t(`orders.status.${o.status}`)}</Chip>
                  {o.payment && (o.payment.status === "DUE" || o.payment.status === "OVERDUE") ? <Chip tone={o.payment.status === "OVERDUE" ? "bad" : "warn"}>{t(`payment.status.${o.payment.status}`)}</Chip> : null}
                </span>
              </div>
              <div className="mt-1 text-sm">{locale === "ar" ? o.supplier.nameAr : o.supplier.nameEn}</div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-sm text-muted">
                <span>{o.items.map((i) => `${locale === "ar" ? i.brandNameAr : i.brandNameEn} × ${i.qtyPacks}`).join("، ")}</span>
                <span className="font-semibold text-ink">{formatSar(o.totalHalalas, locale)}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{t("orders.window")}: {fmtWhen(o.window.start, locale)}</div>
            </Link>
          </li>
        ))}
      </ul>
      {nextCursor ? <Link href={`/orders?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
