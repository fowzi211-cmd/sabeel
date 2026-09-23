import { db } from "@/lib/db";
import { parseJson, route } from "@/lib/http";
import { publishFeeRule, publishFeeRuleSchema } from "@/server/fees";

export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_FINANCE"] }, async () => ({
  rules: await db.feeRule.findMany({ orderBy: { effectiveFrom: "desc" } }),
}));

/** Publishes a new fee rule — must be disclosed at least FEE_CHANGE_NOTICE_DAYS ahead unless it is the first for its scope. */
export const POST = route({ roles: ["ADMIN_FINANCE"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, publishFeeRuleSchema);
  const rule = await publishFeeRule(current.user, input, meta);
  return { rule };
});
