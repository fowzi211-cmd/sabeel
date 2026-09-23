import { z } from "zod";
import { route } from "@/lib/http";
import { listOpenDisputes } from "@/server/payments";

const categories = ["NOT_DELIVERED", "SHORT", "WRONG_BRAND", "DAMAGED", "LATE", "NON_PAYMENT", "OTHER"] as const;

/** The disputes queue (design pack S55): every open dispute, oldest first. */
export const GET = route({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ req }) => {
  const category = z.enum(categories).optional().parse(req.nextUrl.searchParams.get("category") ?? undefined);
  const disputes = await listOpenDisputes(category);
  return {
    disputes: disputes.map((d) => ({
      id: d.id, category: d.category, openedBy: d.openedBy, note: d.note, createdAt: d.createdAt,
      order: { id: d.order.id, orderNo: d.order.orderNo, status: d.order.status, totalHalalas: d.order.totalHalalas, supplierName: d.order.supplier.tradeName || d.order.supplier.legalNameAr },
    })),
  };
});
