import { route } from "@/lib/http";
import { markLegallyReviewed } from "@/server/terms";

export const POST = route<{ id: string }>({ roles: ["SUPER_ADMIN"] }, async ({ params, current, meta }) => {
  const doc = await markLegallyReviewed(current.user, params.id, meta);
  return { terms: { id: doc.id, type: doc.type, version: doc.version, legalReviewedAt: doc.legalReviewedAt } };
});
