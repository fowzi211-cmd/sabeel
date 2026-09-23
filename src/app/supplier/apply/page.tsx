import { redirect } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { ApplyForm } from "@/components/ApplyForm";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("supplier.applyTitle");

export default async function ApplyPage() {
  const { user } = await requirePage({ path: "/supplier/apply" });
  if (await getOwnedSupplier(user.id)) redirect("/supplier");
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeading title={t("supplier.applyTitle")} sub={t("supplier.applyIntro")} />
      <ApplyForm defaultName={user.name ?? ""} defaultMobile={user.mobile} />
    </div>
  );
}
