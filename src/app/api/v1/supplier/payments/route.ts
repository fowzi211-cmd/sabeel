import { z } from "zod";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { feeHalalas, formatSar, supplierKeeps } from "@/lib/money";
import { listSupplierPayments } from "@/server/payments";

const statuses = ["NOT_DUE", "DUE", "BUYER_MARKED_PAID", "RECEIVED", "OVERDUE", "DISPUTED", "VOID"] as const;

/** The supplier's Payments page: every transaction by number, date and cost, with the fee/keep breakdown. */
export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current }) => {
  const sp = req.nextUrl.searchParams;
  const status = z.enum(statuses).optional().parse(sp.get("status") ?? undefined);
  const brandId = sp.get("brandId") ?? undefined;
  const q = sp.get("q")?.trim() || undefined;
  const from = sp.get("from") ? new Date(sp.get("from")!) : undefined;
  const to = sp.get("to") ? new Date(sp.get("to")!) : undefined;

  const supplier = await ownedSupplier(current.user.id);
  const rows = await listSupplierPayments(supplier.id, { status, brandId, from, to, q });
  const payments = rows.map((p) => {
    const fee = feeHalalas(p.order.packetEqMilliTotal, 1, p.order.feePerPacketHalalas);
    const keep = supplierKeeps(p.amountHalalas, fee);
    return {
      id: p.id, transactionNo: p.transactionNo, status: p.status, amountHalalas: p.amountHalalas, dueAt: p.dueAt,
      paymentDate: p.paymentDate, bankReference: p.bankReference, markedPaidAt: p.markedPaidAt, receivedAt: p.receivedAt,
      order: { id: p.order.id, orderNo: p.order.orderNo, placedAt: p.order.placedAt, brands: p.order.items.map((i) => ({ ar: i.brandNameAr, en: i.brandNameEn })) },
      breakdown: { orderTotalHalalas: p.amountHalalas, feeHalalas: fee, feeVatHalalas: keep.feeVat, keepHalalas: keep.keep },
    };
  });
  const totalKept = payments.filter((p) => p.status === "RECEIVED").reduce((s, p) => s + p.breakdown.keepHalalas, 0);
  return { payments, totals: { count: payments.length, keptHalalas: totalKept, kept: formatSar(totalKept, "en") } };
});
