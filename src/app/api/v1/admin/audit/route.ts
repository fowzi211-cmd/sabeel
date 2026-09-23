import { z } from "zod";
import { db } from "@/lib/db";
import { route } from "@/lib/http";

const query = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  actorId: z.string().max(60).optional(),
  cursor: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = route({ roles: ["ADMIN_FINANCE", "ADMIN_OPS"] }, async ({ req }) => {
  const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const rows = await db.auditLog.findMany({
    where: {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
});
