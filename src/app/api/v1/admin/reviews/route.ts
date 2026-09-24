import { route } from "@/lib/http";
import { listAdminReviews } from "@/server/reviews";

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || undefined;
  const flagged = sp.get("flagged") === "1";
  const cursor = sp.get("cursor") ?? undefined;
  const { items: reviews, nextCursor } = await listAdminReviews({ q, flagged }, { cursor });
  return { reviews, nextCursor };
});
