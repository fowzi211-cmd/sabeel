import Link from "next/link";
import { redirect } from "next/navigation";
import { Banner, Card, PageHeading, btnCls } from "@/components/ui";
import { SupplierFeeInvoices } from "@/components/SupplierFeeInvoices";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { listSupplierInvoices, supplierFeeSummary } from "@/server/fees";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("supplierFees.title");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function SupplierFees({ searchParams }: PageProps<"/supplier/fees">) {
  const { user } = await requirePage({ path: "/supplier/fees", roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const cursor = one((await searchParams).cursor);

  const [summary, { items: invoices, nextCursor }] = await Promise.all([supplierFeeSummary(supplier.id), listSupplierInvoices(supplier.id, {}, { cursor })]);

  return (
    <div>
      <SupplierSubnav />
      <PageHeading title={t("supplierFees.title")} sub={t("supplierFees.intro")} />

      {summary.paused ? (
        <div className="mb-4">
          <Banner tone="bad" role="alert">{t("supplierFees.pausedBanner", { reason: summary.pauseReason ? t(`supplierFees.pauseReason.${summary.pauseReason}`) : "" })}</Banner>
        </div>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-bold">{t("supplierFees.ceilingCard")}</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between border-t border-line py-2 sm:col-span-1"><dt className="text-sm text-muted">{t("supplierFees.exposureHalalas")}</dt><dd className="font-semibold">{formatSar(summary.exposureHalalas, locale)}</dd></div>
          <div className="flex justify-between border-t border-line py-2 sm:col-span-1"><dt className="text-sm text-muted">{t("admin.ceiling")}</dt><dd className="font-semibold">{formatSar(summary.creditCeilingHalalas, locale)}</dd></div>
          <div className="flex justify-between border-t border-line py-2 sm:col-span-1"><dt className="text-sm text-muted">{t("admin.cycle")}</dt><dd className="font-semibold">{t(`admin.invoiceCycle.${summary.invoiceCycle}`)}</dd></div>
          <div className="flex justify-between border-t border-line py-2 sm:col-span-1"><dt className="text-sm text-muted">{t("common.status")}</dt><dd className="font-semibold">{t(`admin.band.${summary.band}`)}</dd></div>
        </dl>
        {summary.onTimeInvoicesToEstablished > 0 ? <p className="mt-3 text-sm text-muted">{t("supplierFees.onTimeProgress", { n: summary.onTimeInvoicesToEstablished })}</p> : null}
      </Card>

      <h2 className="mb-3 text-lg font-bold">{t("supplierFees.invoicesTitle")}</h2>
      <SupplierFeeInvoices invoices={invoices.map((i) => ({ ...i, periodStart: i.periodStart.toISOString(), periodEnd: i.periodEnd.toISOString(), dueAt: i.dueAt.toISOString(), paymentDate: i.paymentDate?.toISOString() ?? null }))} />
      {nextCursor ? <Link href={`/supplier/fees?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
