import { pageMeta } from "@/i18n/meta";
import { FeesAdmin } from "@/components/FeesAdmin";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";
import { adminExposureOverview } from "@/server/fees";

export const generateMetadata = pageMeta("admin.feesTitle");

export default async function AdminFees() {
  const { user } = await requirePage({ path: "/admin/fees", roles: ["ADMIN_OPS", "ADMIN_FINANCE"] });
  const { t } = await getI18n();
  const [rules, exposure] = await Promise.all([
    db.feeRule.findMany({ orderBy: { effectiveFrom: "desc" } }),
    adminExposureOverview(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeading title={t("admin.feesTitle")} sub={t("admin.feesIntro")} />
      <FeesAdmin
        canPublish={user.roles.includes("ADMIN_FINANCE") || user.roles.includes("SUPER_ADMIN")}
        rules={rules.map((r) => ({ ...r, effectiveFrom: r.effectiveFrom.toISOString() }))}
        exposure={exposure.map((s) => ({ ...s }))}
      />
    </div>
  );
}
