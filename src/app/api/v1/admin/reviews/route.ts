import { route } from "@/lib/http";
import { listAdminReviews } from "@/server/reviews";

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q")?.trim() || undefined;
  return { reviews: await listAdminReviews({ q }) };
});
