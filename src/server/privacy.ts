// `privacy.purge_location_pings` (design pack §9, risk R10: "driver location misuse — consent · active
// only during delivery · 30-day retention"). This purges only the raw, non-evidentiary navigation pins —
// a driver's corrected pin proposal (Delivery.pinLat/pinLng) and each attempt's own GPS reading
// (DeliveryAttempt.lat/lng) — once the delivery they belong to is no longer active. It never touches
// ProofOfDelivery/ProofPhoto GPS: that is delivery *evidence*, append-only by database trigger, kept for
// the life of the order like every other proof field.
//
// `privacy.mask_recipient_details` is not a separate batch job here: masking is computed live at read
// time (see MASK_AFTER_MS in src/server/driver.ts and RECIPIENT_REVEALED in src/server/orders.ts), which
// is always correct and needs no job to keep it that way. Deleting the underlying recipient name/mobile/
// address outright — as opposed to just withholding them from views — is a separate, larger decision that
// needs a lawyer-defined retention period (Saudi PDPL) before it should be automated; see README's known
// gaps.

import { db } from "@/lib/db";

const DAY = 86_400_000;
/** R10's own number: driver location is kept only while the delivery is active, then 30 days. */
const DRIVER_LOCATION_RETENTION_DAYS = 30;

export async function purgeStaleDriverLocations(now: Date = new Date(), limit = 500) {
  const cutoff = new Date(now.getTime() - DRIVER_LOCATION_RETENTION_DAYS * DAY);
  // "No longer active": delivered, or failed and untouched since (never delivered ⇒ no live trip either way).
  const inactive = [{ deliveredAt: { lte: cutoff } }, { status: "FAILED" as const, deliveredAt: null, updatedAt: { lte: cutoff } }];

  const deliveryIds = await db.delivery.findMany({
    where: { AND: [{ OR: [{ pinLat: { not: null } }, { pinLng: { not: null } }] }, { OR: inactive }] },
    select: { id: true },
    take: limit,
  });
  const deliveries = deliveryIds.length
    ? await db.delivery.updateMany({ where: { id: { in: deliveryIds.map((d) => d.id) } }, data: { pinLat: null, pinLng: null, pinNote: null } })
    : { count: 0 };

  const attemptIds = await db.deliveryAttempt.findMany({
    where: { AND: [{ OR: [{ lat: { not: null } }, { lng: { not: null } }] }, { delivery: { OR: inactive } }] },
    select: { id: true },
    take: limit,
  });
  const attempts = attemptIds.length
    ? await db.deliveryAttempt.updateMany({ where: { id: { in: attemptIds.map((a) => a.id) } }, data: { lat: null, lng: null } })
    : { count: 0 };

  return { deliveriesPurged: deliveries.count, attemptsPurged: attempts.count };
}
