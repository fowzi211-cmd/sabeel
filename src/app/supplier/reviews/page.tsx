import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading, btnCls } from "@/components/ui";
import { SupplierReviewsList } from "@/components/SupplierReviewsList";
import { SupplierSubnav } from "@/components/SupplierSubnav";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { listSupplierReviews } from "@/server/reviews";
import { getOwnedSupplier } from "@/server/suppliers";

export const generateMetadata = pageMeta("supplierReviews.title");
const firstName = (full: string | null) => (full ?? "").trim().split(/\s+/)[0] || "—";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function SupplierReviews({ searchParams }: PageProps<"/supplier/reviews">) {
  const { user } = await requirePage({ path: "/supplier/reviews", roles: ["SUPPLIER_ADMIN"] });
  const { t } = await getI18n();
  const supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  const cursor = one((await searchParams).cursor);

  const { items: reviews, nextCursor } = await listSupplierReviews(supplier.id, { cursor });

  return (
    <div>
      <SupplierSubnav />
      <PageHeading title={t("supplierReviews.title")} sub={t("supplierReviews.intro")} />
      <SupplierReviewsList
        reviews={reviews.map((r) => ({
          id: r.id, stars: r.stars, comment: r.comment, createdAt: r.createdAt.toISOString(),
          orderNo: r.order.orderNo, buyerFirstName: firstName(r.buyer.name),
          reply: r.reply ? { text: r.reply.text, createdAt: r.reply.createdAt.toISOString() } : null,
          flag: r.flag ? { status: r.flag.status } : null,
        }))}
      />
      {nextCursor ? <Link href={`/supplier/reviews?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
