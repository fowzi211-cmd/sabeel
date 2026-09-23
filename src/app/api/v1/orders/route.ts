import { NextResponse } from "next/server";
import { parseJson, route } from "@/lib/http";
import { buyerOrderView, listBuyerOrders, placeOrder, placeSchema } from "@/server/orders";

export const GET = route({}, async ({ current }) => ({
  orders: (await listBuyerOrders(current.user.id)).map((o) => buyerOrderView(o)),
}));

/** Idempotent: send the same `Idempotency-Key` on a retry and you get the original order back. */
export const POST = route({}, async ({ req, current, meta }) => {
  const input = await parseJson(req, placeSchema);
  const key = req.headers.get("idempotency-key")?.trim().slice(0, 80) || null;
  const { order, replay } = await placeOrder(current.user, input, meta, key);
  return NextResponse.json({ order: buyerOrderView(order), replay }, { status: replay ? 200 : 201 });
});
