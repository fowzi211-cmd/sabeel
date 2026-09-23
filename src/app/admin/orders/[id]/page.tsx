import { notFound } from "next/navigation";
import { AdminOrderActions } from "@/components/AdminOrderActions";
import { Card, Chip, PageHeading } from "@/components/ui";
import { OrderTimeline } from "@/components/OrderTimeline";
import { ProofPanel } from "@/components/ProofPanel";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { db } from "@/lib/db";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";
import { formatSar } from "@/lib/money";
import { adminOrderView, getAnyOrder } from "@/server/orders";

export const generateMetadata = pageMeta("admin.orderDetail");

export default async function AdminOrderDetail({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { user } = await requirePage({ path: `/admin/orders/${id}`, roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] });
  const { t, locale } = await getI18n();
  const raw = await getAnyOrder(id);
  if (!raw) notFound();
  const o = adminOrderView(raw);
  const district = await db.district.findUnique({ where: { id: o.destination.districtId } });
  const openDispute = o.disputes.find((d) => d.status === "OPEN") ?? null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]"><dt className="text-sm text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
  );

  return (
    <div className="space-y-4">
      <PageHeading title={t("orders.detailTitle", { no: o.orderNo })} actions={<Chip tone="info">{t(`orders.status.${o.status}`)}</Chip>} />
      <AdminOrderActions
        orderId={o.id} status={o.status} canAct={hasRole(user.roles, "ADMIN_OPS")}
        proofNeedsReview={!!o.proof && o.proof.reviewRequired && !o.proof.reviewedAt}
        openDispute={openDispute} totalHalalas={o.totalHalalas}
      />
      <Card><OrderTimeline status={o.status} events={o.events} /></Card>
      <Card>
        <dl>
          {row(t("admin.buyer"), <>{o.buyer.name ?? "—"} <span className="text-xs text-muted">({t("sorders.tierLabel")} {o.buyerTier})</span>{o.anonymous ? <> <Chip>{t("order.anonymous")}</Chip></> : null}</>)}
          {row(t("admin.supplierCol"), locale === "ar" ? o.supplier.nameAr : o.supplier.nameEn)}
          {row(t("orders.items"), <ul className="space-y-1">{o.items.map((i) => <li key={i.id}>{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("orders.packLine", { ml: i.bottleMl, n: i.bottlesPerPack })} — {t("orders.packs", { qty: i.qtyPacks })} × {formatSar(i.unitPriceHalalas, locale)}</li>)}</ul>)}
          {row(t("orders.total"), <>{formatSar(o.totalHalalas, locale)} <span className="text-xs text-muted">({t("orders.vatIncl")} {formatSar(o.vatHalalas, locale)})</span></>)}
          {row(t("orders.window"), fmtWhen(o.window.start, locale))}
          {row(t("orders.destination"), <>{district ? (locale === "ar" ? district.nameAr : district.nameEn) : ""} · <span className="ltr-iso font-mono">{o.destination.lat.toFixed(5)}, {o.destination.lng.toFixed(5)}</span>{o.destination.landmark ? ` · ${o.destination.landmark}` : ""}</>)}
          {o.destination.recipientName ? row(t("orders.recipient"), <>{o.destination.recipientName} · <span className="ltr-iso">{o.destination.recipientMobile}</span></>) : null}
          {row(t("orders.placedAt"), fmtWhen(o.placedAt, locale))}
          {row(t("sorders.platformFee", { rate: formatSar(o.feePerPacketHalalas, locale) }), <span className="ltr-iso">{(o.packetEqMilliTotal / 1000).toString()} × {formatSar(o.feePerPacketHalalas, locale)}</span>)}
          {o.cancelReason ? row(t("orders.cancelReason"), o.cancelReason) : null}
          {o.driver ? row(t("fulfil.driverLabel"), <>{o.driver.name} · <span className="ltr-iso">{o.driver.mobile}</span>{o.driver.vehiclePlate ? <> · <span className="ltr-iso">{o.driver.vehiclePlate}</span></> : null}</>) : null}
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 font-bold">{t("adminOps.allocationsTitle")}</h2>
        <ol className="space-y-2 text-sm">
          {o.allocations.map((a) => (
            <li key={a.seq} className="flex flex-wrap items-center gap-2 border-t border-line pt-2 first:border-0 first:pt-0">
              <span className="font-mono text-muted">#{a.seq}</span>
              <span className="font-medium">{a.supplierName}</span>
              <Chip tone={a.status === "ACCEPTED" ? "ok" : a.status === "OFFERED" ? "info" : "warn"}>{t(`adminOps.allocStatus.${a.status}`)}</Chip>
              <span className="text-muted">{formatSar(a.totalHalalas, locale)}</span>
              {a.declineReason ? <span className="text-muted">· {t("adminOps.declineReason")}: {t(`fulfil.declineReason.${a.declineReason}`)}{a.declineNote ? ` — ${a.declineNote}` : ""}</span> : null}
            </li>
          ))}
        </ol>
      </Card>

      {o.attempts.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("fulfil.deliveryTitle")}</h2>
          <ul className="space-y-1 text-sm">
            {o.attempts.map((a) => (
              <li key={a.n}>
                {t("fulfil.attempt", { n: a.n })}: {fmtWhen(a.startedAt, locale)}
                {a.arrivedAt ? ` → ${t("fulfil.arrivedAt")} ${fmtWhen(a.arrivedAt, locale)}` : ""}
                {a.outcome === "FAILED" ? <> · <Chip tone="bad">{a.failReason ? t(`fulfil.failReason.${a.failReason}`) : t("fulfil.failedTitle")}</Chip>{a.failNote ? ` — ${a.failNote}` : ""}</> : null}
                {a.outcome === "DELIVERED" ? <> · <Chip tone="ok">{t("fulfil.deliveredAt")}</Chip></> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {o.payment ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("payment.title")}</h2>
          <dl>
            {row(t("common.status"), <Chip tone={o.payment.status === "RECEIVED" ? "ok" : o.payment.status === "OVERDUE" || o.payment.status === "DISPUTED" ? "bad" : "info"}>{t(`payment.status.${o.payment.status}`)}</Chip>)}
            {row(t("payment.transactionNo"), <span className="ltr-iso font-mono">{o.payment.transactionNo}</span>)}
            {row(t("payment.amount"), formatSar(o.payment.amountHalalas, locale))}
            {row(t("payment.dueDate"), fmtWhen(o.payment.dueAt, locale))}
            {o.payment.markedPaidAt ? row(t("sorders.buyerMarkedPaid", { date: fmtWhen(o.payment.paymentDate ?? o.payment.markedPaidAt, locale), ref: o.payment.bankReference ?? "" }), o.payment.receiptUrl ? <a className="text-aqua-700 underline" href={o.payment.receiptUrl} target="_blank" rel="noreferrer">{t("payment.viewReceipt")}</a> : null) : null}
            {o.payment.notReceivedNote ? row(t("sorders.notReceivedNote"), o.payment.notReceivedNote) : null}
            {o.payment.receivedAt ? row(t("payment.status.RECEIVED"), fmtWhen(o.payment.receivedAt, locale)) : null}
          </dl>
        </Card>
      ) : null}

      {o.disputes.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("dispute.history")}</h2>
          <ul className="space-y-2 text-sm">
            {o.disputes.map((d) => (
              <li key={d.id} className="border-t border-line pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={d.status === "OPEN" ? "warn" : "ok"}>{d.status === "OPEN" ? t("common.status") : t("dispute.resolvedTitle")}</Chip>
                  <span className="font-medium">{t(`dispute.category.${d.category}`)}</span>
                  <span className="text-muted">({t(`dispute.openedBy.${d.openedBy}`)})</span>
                  <span className="text-muted">{fmtWhen(d.createdAt, locale)}</span>
                </div>
                <p className="mt-1">{d.note}</p>
                {d.outcome ? <p className="mt-1 text-muted">{t(`dispute.outcome.${d.outcome}`)}{d.resolutionNote ? ` — ${d.resolutionNote}` : ""}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {o.proof ? <ProofPanel proof={o.proof} items={o.items} audience="admin" /> : null}
    </div>
  );
}
