import { route } from "@/lib/http";
import { allPaymentTotals } from "@/server/payments";

/** Platform-wide payment totals plus one line per supplier, over every payment (not one page). */
export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_FINANCE"] }, async () => allPaymentTotals());
