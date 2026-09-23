import { notFound, redirect } from "next/navigation";
import { Banner, Card, Chip, PageHeading } from "@/components/ui";
import { ProofPanel } from "@/components/ProofPanel";
import { SupplierOrderActions } from "@/components/SupplierOrderActions";
import { SupplierPaymentActions } from "@/components/SupplierPaymentActions";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { db } from "@/lib/db";
import { fmtWhen } from "@/lib/format";
import { MAX_DELIVERY_ATTEMPTS } from "@/lib/fulfilment";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { listDrivers } from "@/server/drivers";
import { getSupplierOrder, supplierOrderView } from "@/server/orders";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("sorders.title");

export default async function SupplierOrderDetail({ params }: PageProps<"/supplier/orders/[id]">) {
  const { id } = await params;
  const { user } = await requirePage({ path: `/supplier/orders/${id}`, roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");

  const raw = await getSupplierOrder(supplier.id, id);
  if (!raw) notFound();
  const o = supplierOrderView(raw);
  const [district, drivers] = await Promise.all([db.district.findUnique({ where: { id: o.districtId } }), listDrivers(supplier.id)]);
  const activeDrivers = drivers.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, vehiclePlate: d.vehiclePlate }));
  const fee = o.feePreview;
  const openDispute = o.disputes.find((d) => d.status === "OPEN") ?? null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[170px_1fr]"><dt className="text-sm text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
  );
  const money = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? "border-t border-line pt-2 text-lg font-bold" : ""}`}><span>{label}</span><span>{value}</span></div>
  );
  const tone = o.status === "AWAITING_SUPPLIER" || o.status === "FAILED_ATTEMPT" ? "warn" : o.status === "CANCELLED" ? "bad" : "info";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SupplierSubnav />
      <PageHeading title={t("sorders.detailTitle", { no: o.orderNo })} actions={<Chip tone={tone}>{t(`orders.status.${o.status}`)}</Chip>} />

      <SupplierOrderActions
        orderId={o.id} status={o.status} acceptBy={new Date(o.acceptBy).toISOString()}
        attempts={o.delivery?.attempts ?? 0} maxAttempts={MAX_DELIVERY_ATTEMPTS}
        drivers={activeDrivers} currentDriverId={o.delivery?.driver.id ?? null} canAct={supplier.status === "ACTIVE"}
      />

      <Card>
        <dl>
          {row(t("sorders.donorLabel"), o.anonymous || !o.donor ? t("sorders.anonymousDonor") : o.donor)}
          {row(t("sorders.tierLabel"), o.buyerTier)}
          {row(t("orders.items"), (
            <ul className="space-y-1">
              {o.items.map((i) => <li key={i.id}>{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("orders.packLine", { ml: i.bottleMl, n: i.bottlesPerPack })} — {t("orders.packs", { qty: i.qtyPacks })} × {formatSar(i.unitPriceHalalas, locale)}</li>)}
            </ul>
          ))}
          {row(t("sorders.district"), district ? (locale === "ar" ? district.nameAr : district.nameEn) : "")}
          {row(t("orders.window"), fmtWhen(o.window.start, locale))}
          {o.status === "AWAITING_SUPPLIER" ? row(t("sorders.acceptByLabel"), fmtWhen(o.acceptBy, locale)) : null}
          {o.note ? row(t("orders.note"), o.note) : null}
          {o.cancelReason ? row(t("orders.cancelReason"), o.cancelReason) : null}
        </dl>
      </Card>

      <Card tint>
        <h2 className="mb-2 font-bold">{t("sorders.feeTitle")}</h2>
        <div className="space-y-1.5 text-[15px]">
          {money(t("sorders.orderTotal"), formatSar(o.totalHalalas, locale))}
          {money(t("sorders.platformFee", { rate: formatSar(fee.feePerPacketHalalas, locale) }), `− ${formatSar(fee.fee, locale)}`)}
          {money(t("sorders.vatOnFee"), `− ${formatSar(fee.feeVat, locale)}`)}
          {money(t("sorders.youKeep"), formatSar(fee.keep, locale), true)}
        </div>
      </Card>

      {o.destination ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("sorders.revealed")}</h2>
          <dl>
            {o.destination.recipientName ? row(t("orders.recipient"), <>{o.destination.recipientName} · <span className="ltr-iso">{o.destination.recipientMobile}</span></>) : null}
            {o.destination.landmark ? row(t("order.landmark"), o.destination.landmark) : null}
            {o.destination.accessNotes ? row(t("order.accessNotes"), o.destination.accessNotes) : null}
            {row("GPS", <span className="ltr-iso font-mono">{o.destination.lat.toFixed(5)}, {o.destination.lng.toFixed(5)}</span>)}
          </dl>
        </Card>
      ) : (
        <Banner tone="info">{t("sorders.hidden")}</Banner>
      )}

      {o.delivery ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("fulfil.deliveryTitle")}</h2>
          <dl>
            {row(t("fulfil.driverLabel"), <>{o.delivery.driver.name}{o.delivery.driver.vehiclePlate ? <> · <span className="ltr-iso">{o.delivery.driver.vehiclePlate}</span></> : null}</>)}
            {o.attempts.map((a) => row(
              t("fulfil.attempt", { n: a.n }),
              <span className="text-sm">
                {fmtWhen(a.startedAt, locale)}
                {a.arrivedAt ? ` → ${t("fulfil.arrivedAt")} ${fmtWhen(a.arrivedAt, locale)}` : ""}
                {a.outcome === "FAILED" ? <> · <Chip tone="bad">{a.failReason ? t(`fulfil.failReason.${a.failReason}`) : t("fulfil.failedTitle")}</Chip>{a.failNote ? ` — ${a.failNote}` : ""}</> : null}
                {a.outcome === "DELIVERED" ? <> · <Chip tone="ok">{t("fulfil.deliveredAt")}</Chip></> : null}
              </span>,
            ))}
          </dl>
        </Card>
      ) : null}

      {o.payment ? <SupplierPaymentActions orderId={o.id} payment={o.payment} hasOpenDispute={!!openDispute} /> : null}

      {openDispute ? <Banner tone="warn">{t(openDispute.openedBy === "SUPPLIER" ? "dispute.openBannerSupplierOwn" : "dispute.openBannerSupplier")}</Banner> : null}
      {o.disputes.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-bold">{t("dispute.history")}</h2>
          <ul className="space-y-2 text-sm">
            {o.disputes.map((d) => (
              <li key={d.id} className="border-t border-line pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={d.status === "OPEN" ? "warn" : "ok"}>{t(`dispute.category.${d.category}`)}</Chip>
                  <span className="text-muted">{fmtWhen(d.createdAt, locale)}</span>
                </div>
                {d.outcome ? <p className="mt-1 text-muted">{t(`dispute.outcome.${d.outcome}`)}{d.resolutionNote ? ` — ${d.resolutionNote}` : ""}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {o.proof ? <ProofPanel proof={o.proof} items={o.items} audience="supplier" /> : null}
    </div>
  );
}
