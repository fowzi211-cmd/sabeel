import Link from "next/link";
import { pageMeta } from "@/i18n/meta";
import { Banner, Card, Chip, PageHeading, Table, btnCls, fmtDate, statusTone, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";
import { docsNeedingAttention } from "@/server/compliance";
import { attentionWhere } from "@/server/orders";
import { getCurrentTerms } from "@/server/terms";

export const generateMetadata = pageMeta("admin.dashboardTitle");

export default async function AdminDashboard() {
  const { user } = await requirePage({ path: "/admin", roles: ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE"] });
  const { t, locale } = await getI18n();
  const now = new Date();

  const [counts, queue, inbox, current, attentionOrders, openDisputes, blockedSuppliers, invoicesAwaiting, invoicesOverdue, docs] = await Promise.all([
    db.supplier.groupBy({ by: ["status"], _count: true }),
    db.supplier.findMany({ where: { status: "PENDING" }, orderBy: { submittedAt: "asc" }, take: 10 }),
    db.notification.findMany({ where: { userId: user.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 8 }),
    Promise.all((["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT", "BUYER_TERMS"] as const).map((x) => getCurrentTerms(x))),
    db.order.count({ where: attentionWhere(now) }),
    db.dispute.count({ where: { status: "OPEN" } }),
    db.supplier.count({ where: { status: { in: ["PAUSED", "SUSPENDED"] } } }),
    db.feeInvoice.count({ where: { status: "PAYMENT_SUBMITTED" } }),
    db.feeInvoice.count({ where: { status: "OVERDUE" } }),
    docsNeedingAttention(now),
  ]);

  const unreviewed = current.filter((d) => d && !d.legalReviewedAt).map((d) => t(`admin.termsType.${d!.type}`));
  const statusOrder = ["PENDING", "NEEDS_INFO", "ACTIVE", "PAUSED", "SUSPENDED", "REJECTED", "DRAFT"];
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));

  const tiles = [
    { key: "verification", href: "/admin/suppliers?status=PENDING", count: byStatus.PENDING ?? 0 },
    { key: "orders", href: "/admin/orders?attention=1", count: attentionOrders },
    { key: "disputes", href: "/admin/disputes", count: openDisputes },
    { key: "suppliersBlocked", href: "/admin/fees", count: blockedSuppliers },
    { key: "invoices", href: "/admin/fee-invoices", count: invoicesAwaiting + invoicesOverdue },
    { key: "docs", href: "/admin/suppliers", count: docs.length },
  ] as const;
  const totalNeedingAttention = tiles.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-5">
      <PageHeading title={t("admin.dashboardTitle")} />
      {unreviewed.length ? <Banner tone="warn">{t("admin.legalWarning", { list: unreviewed.join("، ") })}</Banner> : null}

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("admin.queuesTitle")}</h2>
        {totalNeedingAttention === 0 ? (
          <Banner tone="ok">{t("admin.noQueue")}</Banner>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => (
              <Link key={tile.key} href={tile.href} className={`rounded-xl border p-3 hover:border-aqua-500 ${tile.count > 0 ? "border-warn bg-warn-bg" : "border-line bg-white"}`}>
                <div className="text-2xl font-bold">{tile.count}</div>
                <div className="text-xs text-muted">{t(`admin.queueTile.${tile.key}`)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {statusOrder.map((s) => (
          <Link key={s} href={`/admin/suppliers?status=${s}`} className="rounded-xl border border-line bg-white p-3 hover:border-aqua-500">
            <div className="text-2xl font-bold">{byStatus[s] ?? 0}</div>
            <div className="text-xs text-muted">{t(`supplier.status.${s}`)}</div>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("admin.queue")}</h2>
        {queue.length === 0 ? (
          <Banner tone="ok">{t("admin.noQueue")}</Banner>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>{t("common.name")}</th>
                <th className={th}>{t("admin.type")}</th>
                <th className={th}>{t("admin.submittedAt")}</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((s) => (
                <tr key={s.id}>
                  <td className={td}>{s.legalNameAr}</td>
                  <td className={td}>{s.type === "INDEPENDENT" ? t("supplier.typeIndependent") : t("supplier.typeBrand")}</td>
                  <td className={td}>{s.submittedAt ? fmtDate(s.submittedAt, locale, true) : "—"}</td>
                  <td className={td}><Link href={`/admin/suppliers/${s.id}`} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.review")}</Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {docs.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-bold">{t("admin.docsQueueTitle")}</h2>
          <Table>
            <thead>
              <tr>
                <th className={th}>{t("admin.supplierCol")}</th>
                <th className={th}>{t("admin.docKindCol")}</th>
                <th className={th}>{t("common.status")}</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{d.supplierName}</td>
                  <td className={td}>{t(`supplier.docKind.${d.kind}`)}</td>
                  <td className={td}>
                    {d.expired ? <Chip tone="bad">{t("admin.docExpired")}</Chip> : <Chip tone="warn">{t("admin.docExpiringOn", { date: fmtDate(d.expiresAt, locale) })}</Chip>}
                  </td>
                  <td className={td}><Link href={`/admin/suppliers/${d.supplierId}`} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.review")}</Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t("admin.inbox")}</h2>
        {inbox.length === 0 ? (
          <p className="text-muted">{t("common.none")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {inbox.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Chip tone={statusTone("PENDING")}>{n.event}</Chip></span>
                <span className="text-muted">{fmtDate(n.createdAt, locale, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
