import { AdminReviewsList } from "@/components/AdminReviewsList";
import { PageHeading } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { listAdminReviews } from "@/server/reviews";

export const generateMetadata = pageMeta("adminReviews.title");

export default async function AdminReviewsPage() {
  await requirePage({ path: "/admin/reviews", roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t } = await getI18n();
  const reviews = await listAdminReviews();

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
    </div>
  );
}
