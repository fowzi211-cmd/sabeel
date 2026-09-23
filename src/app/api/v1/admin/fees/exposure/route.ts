import { route } from "@/lib/http";
import { adminExposureOverview } from "@/server/fees";

/** The credit-ceiling exposure dashboard: every supplier with anything outstanding, worst band first. */
export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_FINANCE"] }, async () => ({
  suppliers: await adminExposureOverview(),
}));
