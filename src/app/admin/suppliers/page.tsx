import Link from "next/link";
import { pageMeta } from "@/i18n/meta";
import { Chip, PageHeading, Table, btnCls, fmtDate, statusTone, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { listSuppliers } from "@/server/suppliers";
import type { SupplierStatus } from "@prisma/client";

export const generateMetadata = pageMeta("admin.suppliersTitle");
const STATUSES: SupplierStatus[] = ["PENDING", "NEEDS_INFO", "ACTIVE", "PAUSED", "SUSPENDED", "REJECTED", "DRAFT"];

export default async function AdminSuppliers({ searchParams }: PageProps<"/admin/suppliers">) {
  await requirePage({ path: "/admin/suppliers", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = STATUSES.find((s) => s === raw);
  const suppliers = await listSuppliers(status);

  const tab = (active: boolean) => `rounded-full px-3 py-1 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-white text-aqua-700 ring-1 ring-line hover:bg-aqua-100"}`;

  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.suppliersTitle")} />
      <div className="flex flex-wrap gap-1.5">
        <Link href="/admin/suppliers" className={tab(!status)}>{t("admin.filterAll")}</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/suppliers?status=${s}`} className={tab(status === s)}>{t(`supplier.status.${s}`)}</Link>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("common.name")}</th>
            <th className={th}>{t("admin.type")}</th>
            <th className={th}>{t("admin.contact")}</th>
            <th className={th}>{t("common.status")}</th>
            <th className={th}>{t("admin.submittedAt")}</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {suppliers.length === 0 ? (
            <tr><td className={td} colSpan={6}>{t("common.none")}</td></tr>
          ) : (
            suppliers.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.legalNameAr}<div className="ltr-iso text-xs text-muted">{s.crNumber}</div></td>
                <td className={td}>{s.type === "INDEPENDENT" ? t("supplier.typeIndependent") : t("supplier.typeBrand")}</td>
                <td className={td}>{s.contactName}<div className="ltr-iso text-xs text-muted">{s.contactMobile}</div></td>
                <td className={td}><Chip tone={statusTone(s.status)}>{t(`supplier.status.${s.status}`)}</Chip></td>
                <td className={td}>{s.submittedAt ? fmtDate(s.submittedAt, locale, true) : "—"}</td>
                <td className={td}><Link href={`/admin/suppliers/${s.id}`} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.review")}</Link></td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}
