import { pageMeta } from "@/i18n/meta";
import { PageHeading } from "@/components/ui";
import { UsersAdmin } from "@/components/UsersAdmin";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { listUsers } from "@/server/users";

export const generateMetadata = pageMeta("admin.usersTitle");

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const { user } = await requirePage({ path: "/admin/users", roles: ["SUPER_ADMIN"] });
  const { t } = await getI18n();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim();
  const users = await listUsers(q || undefined);

  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.usersTitle")} />
      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} placeholder={t("admin.search")} aria-label={t("admin.search")} className="w-full rounded-[10px] border-[1.5px] border-line bg-white px-3 py-2.5" />
        <button className="rounded-[10px] bg-aqua-600 px-4 font-semibold text-white">🔎</button>
      </form>
      <UsersAdmin
        meId={user.id}
        users={users.map((u) => ({ ...u, totpEnabledAt: u.totpEnabledAt?.toISOString() ?? null, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, roles: u.roles }))}
      />
    </div>
  );
}
