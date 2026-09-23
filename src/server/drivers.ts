import { z } from "zod";
import { Prisma, type Supplier, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit, type RequestMeta } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { normalizeSaudiMobile } from "@/lib/validate";
import { notifyUser } from "./notify";
import { getCurrentTerms } from "./terms";

export const driverSchema = z.object({
  mobile: z.string().trim().min(9).max(20),
  name: z.string().trim().min(2).max(80),
  vehiclePlate: z.string().trim().max(20).optional(),
  licenceNo: z.string().trim().max(30).optional(),
});
export type DriverInput = z.infer<typeof driverSchema>;

export const driverPatchSchema = z.object({
  active: z.boolean().optional(),
  vehiclePlate: z.string().trim().max(20).nullish(),
  licenceNo: z.string().trim().max(30).nullish(),
});

/** Statuses in which a driver is still expected to deliver something. */
const OPEN_ORDER_STATUSES = ["ASSIGNED", "OUT_FOR_DELIVERY"] as const;

/**
 * Adds a person as a driver for this supplier. They may not have an account yet: one is created with the
 * driver role. Nothing is shared with them until they sign in with their own mobile and accept the
 * driver acknowledgement.
 */
export async function addDriver(actor: User, supplier: Supplier, input: DriverInput, meta: RequestMeta) {
  if (supplier.status !== "ACTIVE") throw new AppError("SUPPLIER_NOT_ACTIVE");
  const mobile = normalizeSaudiMobile(input.mobile);
  if (!mobile) throw new AppError("MOBILE_INVALID", { field: "mobile" });

  const existing = await db.user.findUnique({ where: { mobile } });
  if (existing?.status === "BLOCKED") throw new AppError("ACCOUNT_BLOCKED");

  const driver = await db.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { roles: existing.roles.includes("DRIVER") ? undefined : { set: [...existing.roles, "DRIVER"] }, name: existing.name?.trim() ? undefined : input.name },
        })
      : await tx.user.create({ data: { mobile, name: input.name, roles: ["DRIVER"] } });
    const created = await tx.driver.create({
      data: { supplierId: supplier.id, userId: user.id, vehiclePlate: input.vehiclePlate || null, licenceNo: input.licenceNo || null },
      include: { user: { select: { id: true, mobile: true, name: true, language: true } } },
    });
    await audit({ actor, action: "driver.added", entity: "Driver", entityId: created.id, after: { supplierId: supplier.id, userId: user.id }, meta }, tx);
    return created;
  }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("CONFLICT", { message: "This person is already one of your drivers" });
    throw e;
  });

  if (driver.userId !== actor.id) {
    const who = supplier.tradeName || supplier.legalNameAr;
    await notifyUser(driver.user, "driver.added", {
      ar: `سبيل: أضافك المورّد ${who} كسائق. سجّل الدخول برقمك هذا على ${getEnv().APP_ORIGIN}/driver ووافق على إقرار السائق.`,
      en: `Sabeel: ${who} added you as a driver. Sign in with this number at ${getEnv().APP_ORIGIN}/driver and accept the driver acknowledgement.`,
    }, { supplierId: supplier.id });
  }
  return driver;
}

/** An owner or independent distributor who delivers themself lists their own account as a driver. */
export async function addSelfAsDriver(owner: User, supplier: Supplier, extra: { vehiclePlate?: string; licenceNo?: string }, meta: RequestMeta) {
  if (!owner.name?.trim()) throw new AppError("PROFILE_INCOMPLETE");
  return addDriver(owner, supplier, { mobile: owner.mobile, name: owner.name, vehiclePlate: extra.vehiclePlate, licenceNo: extra.licenceNo }, meta);
}

export async function updateDriver(actor: User, supplier: Supplier, driverId: string, patch: z.infer<typeof driverPatchSchema>, meta: RequestMeta) {
  const driver = await db.driver.findFirst({ where: { id: driverId, supplierId: supplier.id } });
  if (!driver) throw new AppError("NOT_FOUND");

  if (patch.active === false && driver.active) {
    const busy = await db.delivery.count({ where: { driverId, order: { status: { in: [...OPEN_ORDER_STATUSES] } } } });
    if (busy > 0) throw new AppError("DRIVER_BUSY", { details: { deliveries: busy } });
  }
  const updated = await db.driver.update({
    where: { id: driverId },
    data: {
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.vehiclePlate !== undefined ? { vehiclePlate: patch.vehiclePlate || null } : {}),
      ...(patch.licenceNo !== undefined ? { licenceNo: patch.licenceNo || null } : {}),
    },
  });
  await audit({ actor, action: "driver.updated", entity: "Driver", entityId: driverId, before: { active: driver.active }, after: { active: updated.active }, meta });
  return updated;
}

export async function listDrivers(supplierId: string) {
  const drivers = await db.driver.findMany({
    where: { supplierId },
    include: { user: { select: { id: true, name: true, mobile: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  const doc = await getCurrentTerms("DRIVER_ACK");
  const accepted = doc
    ? new Set((await db.termsAcceptance.findMany({ where: { termsDocumentId: doc.id, userId: { in: drivers.map((d) => d.userId) } }, select: { userId: true } })).map((a) => a.userId))
    : new Set<string>();
  const open = await db.delivery.groupBy({
    by: ["driverId"],
    where: { driverId: { in: drivers.map((d) => d.id) }, order: { status: { in: [...OPEN_ORDER_STATUSES] } } },
    _count: { _all: true },
  });
  const openBy = new Map(open.map((o) => [o.driverId, o._count._all]));
  return drivers.map((d) => ({
    id: d.id, active: d.active, name: d.user.name, mobile: d.user.mobile, vehiclePlate: d.vehiclePlate, licenceNo: d.licenceNo,
    ackAccepted: !doc || accepted.has(d.userId), openDeliveries: openBy.get(d.id) ?? 0, isOwner: false,
  }));
}
