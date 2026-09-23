import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { safeDocument } from "@/server/serialize";
import { reviewDocument } from "@/server/suppliers";

const schema = z.object({ action: z.enum(["verify", "reject"]), reason: z.string().trim().max(300).optional() });

export const POST = route<{ id: string; docId: string }>({ roles: ["ADMIN_OPS"] }, async ({ req, params, current, meta }) => {
  const { action, reason } = await parseJson(req, schema);
  const doc = await db.supplierDocument.findFirst({ where: { id: params.docId, supplierId: params.id } });
  if (!doc) throw new AppError("NOT_FOUND");
  const updated = await reviewDocument(current.user, params.docId, action, reason, meta);
  return { document: safeDocument(updated) };
});
