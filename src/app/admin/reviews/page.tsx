import Link from "next/link";
import { AdminReviewsList } from "@/components/AdminReviewsList";
import { PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { listAdminReviews } from "@/server/reviews";

export const generateMetadata = pageMeta("adminReviews.title");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requirePage({ path: "/admin/reviews", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t } = await getI18n();
  const cursor = one((await searchParams).cursor);
  const { items: reviews, nextCursor } = await listAdminReviews({}, { cursor });

  return (
    <div className="space-y-4">
      <PageHeading title={t("adminReviews.title")} sub={t("adminReviews.intro")} />
      <AdminReviewsList
        reviews={reviews.map((r) => ({
          id: r.id, stars: r.stars, comment: r.comment, createdAt: r.createdAt.toISOString(),
          orderNo: r.order.orderNo, supplierName: r.supplier.tradeName || r.supplier.legalNameAr,
          buyerName: r.buyer.name, removedAt: r.removedAt?.toISOString() ?? null,
          reply: r.reply ? { text: r.reply.text } : null,
        }))}
      />
      {nextCursor ? <Link href={`/admin/reviews?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
