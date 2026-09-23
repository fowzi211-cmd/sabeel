import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { ownedSupplier } from "@/server/fulfilment";
import { getInvoiceWithAccruals } from "@/server/fees";

export const GET = route<{ id: string }>({ roles: ["SUPPLIER_ADMIN"] }, async ({ params, current }) => {
  const supplier = await ownedSupplier(current.user.id);
  const invoice = await getInvoiceWithAccruals(params.id);
  if (!invoice || invoice.supplierId !== supplier.id) throw new AppError("NOT_FOUND");
  return {
    invoice: {
      ...invoice,
      receiptUrl: invoice.receiptFileKey ? `/api/v1/supplier/fee-invoices/${invoice.id}/receipt` : null,
      accruals: invoice.accruals.map((a) => ({ id: a.id, orderNo: a.order.orderNo, packetEqMilli: a.packetEqMilli, ratePerPacketHalalas: a.ratePerPacketHalalas, amountHalalas: a.amountHalalas, vatHalalas: a.vatHalalas, accruedAt: a.accruedAt })),
    },
  };
});
