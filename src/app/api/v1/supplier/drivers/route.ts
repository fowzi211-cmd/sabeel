import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { addDriver, addSelfAsDriver, driverSchema, listDrivers } from "@/server/drivers";
import { ownedSupplier } from "@/server/fulfilment";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  const supplier = await ownedSupplier(current.user.id);
  return { drivers: await listDrivers(supplier.id) };
});

const body = z.union([
  z.object({ self: z.literal(true), vehiclePlate: z.string().trim().max(20).optional(), licenceNo: z.string().trim().max(30).optional() }),
  driverSchema,
]);

/** Add a driver by mobile number, or `{ self: true }` when the owner delivers personally. */
export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  const input = await parseJson(req, body);
  const supplier = await ownedSupplier(current.user.id);
  const driver = "self" in input
    ? await addSelfAsDriver(current.user, supplier, input, meta)
    : await addDriver(current.user, supplier, input, meta);
  return { driver: { id: driver.id } };
});
