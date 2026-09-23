import Link from "next/link";
import { pageMeta } from "@/i18n/meta";
import { Banner, PageHeading, Table, btnCls, fmtDate, inputCls, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";

export const generateMetadata = pageMeta("admin.auditTitle");
const PAGE = 50;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function AdminAudit({ searchParams }: PageProps<"/admin/audit">) {
  await requirePage({ path: "/admin/audit", roles: ["ADMIN_OPS", "ADMIN_FINANCE"] });
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const action = one(sp.action);
  const entity = one(sp.entity);
  const cursor = one(sp.cursor);

  const rows = await db.auditLog.findMany({
    where: { ...(action ? { action: { startsWith: action } } : {}), ...(entity ? { entity } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const more = rows.length > PAGE;
  const items = more ? rows.slice(0, PAGE) : rows;

  const actorIds = [...new Set(items.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, mobile: true } });
  const actorName = new Map(actors.map((a) => [a.id, a.name ?? a.mobile]));

  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(action ? { action } : {}), ...(entity ? { entity } : {}), ...extra }).toString();

  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.auditTitle")} sub={t("admin.auditIntro")} />
      <form className="flex flex-wrap gap-2" role="search">
        <input name="action" defaultValue={action} placeholder={t("admin.filterAction")} aria-label={t("admin.action")} className={`${inputCls} max-w-xs`} dir="ltr" />
        <input name="entity" defaultValue={entity} placeholder={t("admin.entity")} aria-label={t("admin.entity")} className={`${inputCls} max-w-[200px]`} dir="ltr" />
        <button className={btnCls("primary")}>🔎</button>
      </form>
      {items.length === 0 ? <Banner tone="info">{t("common.none")}</Banner> : (
        <Table>
          <thead>
            <tr>
              <th className={th}>{t("common.date")}</th>
              <th className={th}>{t("admin.actor")}</th>
              <th className={th}>{t("admin.action")}</th>
              <th className={th}>{t("admin.entity")}</th>
              <th className={th}>{t("common.note")}</th>
              <th className={th}>IP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap`}>{fmtDate(r.createdAt, locale, true)}</td>
                <td className={td}>{r.actorId ? actorName.get(r.actorId) ?? r.actorId : "—"}</td>
                <td className={td}><span className="ltr-iso font-mono text-xs">{r.action}</span></td>
                <td className={td}><span className="ltr-iso font-mono text-xs">{r.entity}{r.entityId ? `:${r.entityId.slice(0, 8)}` : ""}</span></td>
                <td className={td}>{r.note ?? ""}</td>
                <td className={td}><span className="ltr-iso font-mono text-xs">{r.ip ?? "—"}</span></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {more ? <Link className={btnCls("secondary")} href={`/admin/audit?${qs({ cursor: items[items.length - 1].id })}`}>{t("admin.older")}</Link> : null}
    </div>
  );
}
