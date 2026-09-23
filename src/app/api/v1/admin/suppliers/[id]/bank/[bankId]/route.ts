import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { reviewBankAccount } from "@/server/suppliers";

const schema = z.object({ action: z.enum(["verify", "reject"]), reason: z.string().trim().max(300).optional() });

export const POST = route<{ id: string; bankId: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { action, reason } = await parseJson(req, schema);
  const bank = await db.bankAccount.findFirst({ where: { id: params.bankId, supplierId: params.id } });
  if (!bank) throw new AppError("NOT_FOUND");
  const updated = await reviewBankAccount(current.user, params.bankId, action, reason, meta);
  return { bankAccount: updated };
});
