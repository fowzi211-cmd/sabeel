import Link from "next/link";
import { Card, Chip, PageHeading, Table, btnCls, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { fmtWhen } from "@/lib/format";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { listOpenDisputes } from "@/server/payments";

export const generateMetadata = pageMeta("adminDisputes.title");

export default async function AdminDisputes() {
  await requirePage({ path: "/admin/disputes", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t, locale } = await getI18n();
  const disputes = await listOpenDisputes();

  return (
    <div className="space-y-4">
      <PageHeading title={t("adminDisputes.title")} sub={t("adminDisputes.intro")} />
      {disputes.length === 0 ? <Card><p className="text-muted">{t("adminDisputes.empty")}</p></Card> : null}
      {disputes.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th className={th}>{t("admin.orderNo")}</th>
              <th className={th}>{t("adminDisputes.category")}</th>
              <th className={th}>{t("admin.supplierCol")}</th>
              <th className={th}>{t("orders.total")}</th>
              <th className={th}>{t("orders.placedAt")}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id}>
                <td className={td}><span className="ltr-iso font-mono">{d.order.orderNo}</span></td>
                <td className={td}><Chip tone="warn">{t(`dispute.category.${d.category}`)}</Chip> <span className="text-xs text-muted">({t(`dispute.openedBy.${d.openedBy}`)})</span></td>
                <td className={td}>{d.order.supplier.tradeName || d.order.supplier.legalNameAr}</td>
                <td className={td}>{formatSar(d.order.totalHalalas, locale)}</td>
                <td className={td}>{fmtWhen(d.createdAt, locale)}</td>
                <td className={td}><Link href={`/admin/orders/${d.order.id}`} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("adminDisputes.review")}</Link></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
