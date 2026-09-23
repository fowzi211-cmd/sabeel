import Link from "next/link";
import { AdminFeeInvoices } from "@/components/AdminFeeInvoices";
import { PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { listAdminInvoices } from "@/server/fees";

export const generateMetadata = pageMeta("adminFeeInvoices.title");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function AdminFeeInvoicesPage({ searchParams }: PageProps<"/admin/fee-invoices">) {
  await requirePage({ path: "/admin/fee-invoices", roles: ["ADMIN_OPS", "ADMIN_FINANCE"] });
  const { t } = await getI18n();
  const cursor = one((await searchParams).cursor);
  const { items: invoices, nextCursor } = await listAdminInvoices({}, { cursor });

  return (
    <div className="space-y-4">
      <PageHeading title={t("adminFeeInvoices.title")} sub={t("adminFeeInvoices.intro")} />
      <AdminFeeInvoices
        invoices={invoices.map((i) => ({
          id: i.id, invoiceNo: i.invoiceNo, periodStart: i.periodStart.toISOString(), periodEnd: i.periodEnd.toISOString(),
          totalHalalas: i.totalHalalas, status: i.status, dueAt: i.dueAt.toISOString(),
          supplier: { tradeName: i.supplier.tradeName, legalNameAr: i.supplier.legalNameAr },
        }))}
      />
      {nextCursor ? <Link href={`/admin/fee-invoices?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
