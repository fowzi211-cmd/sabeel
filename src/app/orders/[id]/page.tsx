import { notFound } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { Banner, Card, Chip, PageHeading } from "@/components/ui";
import { BuyerConfirmDelivery } from "@/components/BuyerConfirmDelivery";
import { BuyerPaymentCard } from "@/components/BuyerPaymentCard";
import { CancelOrder } from "@/components/CancelOrder";
import { OrderTimeline } from "@/components/OrderTimeline";
import { ReviewForm } from "@/components/ReviewForm";
import { getI18n } from "@/i18n";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { db } from "@/lib/db";
import { buyerOrderView, getBuyerOrder } from "@/server/orders";

export const generateMetadata = pageMeta("admin.orderDetail");

export default async function OrderDetail({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { user } = await requirePage({ path: `/orders/${id}` });
  const { t, locale } = await getI18n();

  const raw = await getBuyerOrder(user.id, id);
  if (!raw) notFound(); // also the answer for someone else's order
  const o = buyerOrderView(raw);
  const district = await db.district.findUnique({ where: { id: o.destination.districtId } });
  const dName = district ? (locale === "ar" ? district.nameAr : district.nameEn) : "";
  const cancelledAlready = o.status === "CANCELLED";
  const delivered = ["DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW", "CONFIRMED_BY_BOTH", "DISPUTED", "PAID", "CLOSED"].includes(o.status);
  const tone = cancelledAlready ? "bad" : o.status === "FAILED_ATTEMPT" || o.status === "ESCALATED" ? "warn" : "info";

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]"><dt className="text-sm text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeading title={t("orders.detailTitle", { no: o.orderNo })} actions={<Chip tone={tone}>{t(`orders.status.${o.status}`)}</Chip>} />

      {o.status === "OUT_FOR_DELIVERY" && o.driver ? <Banner tone="ok" role="status">{t("fulfil.onTheWay", { name: o.driver.firstName })}</Banner> : null}
      {o.status === "ESCALATED" ? <Banner tone="warn">{t("fulfil.escalatedBanner")}</Banner> : null}
      {o.status === "FAILED_ATTEMPT" ? <Banner tone="warn">{t("fulfil.failedBanner")}</Banner> : null}

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("orders.timeline")}</h2>
        <OrderTimeline status={o.status} events={o.events} />
      </Card>

      {o.report ? (
        <Card>
          <h2 className="text-lg font-bold">{t("fulfil.reportTitle")}</h2>
          <p className="mb-3 text-sm text-muted">{t("fulfil.reportIntro")}</p>
          <ul className="mb-3 space-y-1">
            {o.report.items.map((i) => (
              <li key={i.id}>{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("fulfil.deliveredQty", { d: i.deliveredQtyPacks, o: i.orderedQtyPacks })}</li>
            ))}
          </ul>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {o.report.partial ? <Chip tone="warn">{t("fulfil.partial")}</Chip> : null}
            <Chip tone={o.report.atLocation ? "ok" : "warn"}>{o.report.atLocation ? t("fulfil.atLocation") : t("fulfil.awayFromLocation")}</Chip>
            <Chip tone={o.report.recipientCodeVerified ? "ok" : "warn"}>{o.report.recipientCodeVerified ? t("fulfil.codeOk") : t("fulfil.codeMissing")}</Chip>
          </div>
          {o.report.batchNote ? <p className="mb-3 text-sm"><span className="text-muted">{t("fulfil.batchNote")}: </span>{o.report.batchNote}</p> : null}
          {o.report.deliveredAt ? <p className="mb-3 text-sm text-muted">{t("fulfil.deliveredAt")}: {fmtWhen(o.report.deliveredAt, locale)}</p> : null}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {o.report.photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-[10px] border border-line bg-page">
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* Private, authorised route: not a candidate for the public image optimiser. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={t(`fulfil.photoKind.${p.kind}`)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                </a>
                <div className="px-2 py-1 text-xs text-muted">{t(`fulfil.photoKind.${p.kind}`)}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {o.confirmable ? <BuyerConfirmDelivery orderId={o.id} /> : null}
      {o.disputes.some((d) => d.status === "OPEN" && d.category !== "NON_PAYMENT") ? <Banner tone="warn">{t("dispute.openBannerBuyer")}</Banner> : null}
      {o.payment ? <BuyerPaymentCard orderId={o.id} payment={o.payment} /> : null}
      {o.review || o.reviewable ? <ReviewForm orderId={o.id} review={o.review} reviewable={o.reviewable} /> : null}

      <Card>
        <dl>
          {row(t("orders.supplier"), <>{locale === "ar" ? o.supplier.nameAr : o.supplier.nameEn}{o.supplier.independent ? <> <Chip>🚚 {t("order.independent")}</Chip></> : null}</>)}
          {o.driver ? row(t("fulfil.driverLabel"), <>{o.driver.firstName}{o.driver.vehiclePlate ? <> · <span className="ltr-iso">{o.driver.vehiclePlate}</span></> : null}</>) : null}
          {row(t("orders.items"), (
            <ul className="space-y-1">
              {o.items.map((i) => (
                <li key={i.id}>
                  {locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("orders.packLine", { ml: i.bottleMl, n: i.bottlesPerPack })} — {t("orders.packs", { qty: i.qtyPacks })} × {formatSar(i.unitPriceHalalas, locale)}
                </li>
              ))}
            </ul>
          ))}
          {row(t("orders.window"), fmtWhen(o.window.start, locale))}
          {row(t("orders.destination"), <>{dName}{o.destination.landmark ? ` · ${o.destination.landmark}` : ""}{o.destination.nationalAddress ? <> · <span className="ltr-iso font-mono">{o.destination.nationalAddress}</span></> : null}</>)}
          {o.destination.recipientName ? row(t("orders.recipient"), <>{o.destination.recipientName}{o.destination.recipientMobile ? <> · <span className="ltr-iso">{o.destination.recipientMobile}</span></> : null}</>) : null}
          {o.note ? row(t("orders.note"), o.note) : null}
          {row(t("orders.placedAt"), fmtWhen(o.placedAt, locale))}
          {o.status === "AWAITING_SUPPLIER" ? row(t("orders.acceptBy"), fmtWhen(o.acceptBy, locale)) : null}
          {o.cancelReason ? row(t("orders.cancelReason"), o.cancelReason) : null}
        </dl>
      </Card>

      <Card>
        <div className="space-y-1.5">
          <div className="flex justify-between"><span>{t("orders.goods")}</span><span>{formatSar(o.goodsHalalas, locale)}</span></div>
          <div className="flex justify-between"><span>{t("orders.delivery")}</span><span>{formatSar(o.deliveryHalalas, locale)}</span></div>
          <div className="flex justify-between text-xs text-muted"><span>{t("orders.vatIncl")}</span><span>{formatSar(o.vatHalalas, locale)}</span></div>
          <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><span>{t("orders.total")}</span><span>{formatSar(o.totalHalalas, locale)}</span></div>
        </div>
      </Card>

      {!cancelledAlready && !delivered ? <Banner tone="ok">{t("orders.payLater")}</Banner> : null}
      {o.cancellable ? <CancelOrder orderId={o.id} /> : !cancelledAlready && !delivered ? <Banner tone="info">{t("orders.cancelUnavailable")}</Banner> : cancelledAlready ? <Banner tone="info">{t("orders.cancelled")}</Banner> : null}
    </div>
  );
}
