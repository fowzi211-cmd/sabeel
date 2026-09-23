import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { createOffer, currentFeePerPacket, listOffers, offerSchema, requireLiveSupplier } from "@/server/catalogue";
import { db } from "@/lib/db";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  const supplier = await db.supplier.findFirst({ where: { members: { some: { userId: current.user.id, role: "OWNER" } } } });
  if (!supplier) throw new AppError("NOT_FOUND");
  return { offers: await listOffers(supplier.id), feePerPacketHalalas: await currentFeePerPacket() };
});

export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, offerSchema);
  const supplier = await requireLiveSupplier(current.user.id);
  return { offer: await createOffer(current.user, supplier, input, meta) };
});
