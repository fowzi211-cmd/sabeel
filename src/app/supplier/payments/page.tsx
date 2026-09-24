import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Chip, PageHeading, Table, btnCls, td, th } from "@/components/ui";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { feeHalalas, formatSar, supplierKeeps } from "@/lib/money";
import { listSupplierPayments, supplierPaymentTotals } from "@/server/payments";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("payments.title");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function SupplierPayments({ searchParams }: PageProps<"/supplier/payments">) {
  const { user } = await requirePage({ path: "/supplier/payments", roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const cursor = one((await searchParams).cursor);

  const [{ items: rows, nextCursor }, totals] = await Promise.all([listSupplierPayments(supplier.id, {}, { cursor }), supplierPaymentTotals(supplier.id)]);
  const payments = rows.map((p) => {
    const fee = feeHalalas(p.order.packetEqMilliTotal, 1, p.order.feePerPacketHalalas);
    return { ...p, fee, keep: supplierKeeps(p.amountHalalas, fee).keep };
  });
  const tone = (status: string) => (status === "RECEIVED" ? "ok" : status === "OVERDUE" || status === "DISPUTED" ? "bad" : "info");

  return (
    <div>
      <SupplierSubnav />
      <PageHeading title={t("payments.title")} sub={t("payments.intro")} />
      {payments.length === 0 ? <Card><p className="text-muted">{t("payments.empty")}</p></Card> : null}
      {payments.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-muted">{t("payments.totalsLine", { n: totals.count, amount: formatSar(totals.received.keptHalalas, locale) })}</p>
          <Table>
            <thead>
              <tr>
                <th className={th}>{t("payments.col.transaction")}</th>
                <th className={th}>{t("payments.col.order")}</th>
                <th className={th}>{t("payments.col.date")}</th>
                <th className={th}>{t("payments.col.brand")}</th>
                <th className={th}>{t("payments.col.status")}</th>
                <th className={th}>{t("payments.col.total")}</th>
                <th className={th}>{t("payments.col.fee")}</th>
                <th className={th}>{t("payments.col.keep")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className={td}><span className="ltr-iso font-mono">{p.transactionNo}</span></td>
                  <td className={td}><Link href={`/supplier/orders/${p.order.id}`} className="text-aqua-700 underline"><span className="ltr-iso font-mono">{p.order.orderNo}</span></Link></td>
                  <td className={td}>{fmtWhen(p.order.placedAt, locale)}</td>
                  <td className={td}>{[...new Set(p.order.items.map((i) => (locale === "ar" ? i.brandNameAr : i.brandNameEn)))].join("، ")}</td>
                  <td className={td}><Chip tone={tone(p.status)}>{t(`payment.status.${p.status}`)}</Chip></td>
                  <td className={td}>{formatSar(p.amountHalalas, locale)}</td>
                  <td className={td}>{formatSar(p.fee, locale)}</td>
                  <td className={td}>{formatSar(p.keep, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
      {nextCursor ? <Link href={`/supplier/payments?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
