/**
 * End-to-end verification of slice 6 (admin queues, hardening, backups, docs) against a RUNNING dev
 * server and the dev DB:   npm run verify:6
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { docsNeedingAttention, sendDocumentExpiryNotices } from "../src/server/compliance";
import { publishTerms, sendReacceptanceNudges } from "../src/server/terms";
import { purgeStaleDriverLocations } from "../src/server/privacy";

const OPS_MOBILE = "+966500000002"; // seeded ADMIN_OPS
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });
const supplierInApp = (supplierId: string, event: string) =>
  db.notification.count({ where: { event, channel: "IN_APP", user: { supplierMemberships: { some: { supplierId, role: "OWNER" } } } } });

interface Sup { c: Client; id: string; mobile: string; userId: string; name: string }

async function makeSupplier(name: string) {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: "BRAND_COMPANY", status: "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name, tradeName: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 25_000, invoiceCycle: "WEEKLY",
      members: { create: { userId: owner.id, role: "OWNER" } },
      bankAccounts: { create: { iban: `SA${rnd(22)}`, holderName: name, bankName: "Test Bank", status: "ACTIVE", activatedAt: new Date() } },
    },
  });
  const c = new Client();
  await login(c, mobile);
  await enrol(c);
  const code = must(await c.post("/api/v1/terms/sign-code", { type: "SUPPLIER_AGREEMENT", version: "1.0" }), "sign code").json.devCode;
  must(await c.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "AR", confirmRead: true, authorised: true, code }), "accept agreement");
  return { c, id: sup.id, mobile, userId: owner.id, name } satisfies Sup;
}

/** A driver, a bare-bones order and a Delivery row created directly — the location-purge job only
 *  cares about Delivery/DeliveryAttempt rows, not the full accept→deliver flow (already covered by
 *  slices 3/4's own scripts). */
async function makeStaleDelivery(supplierId: string, buyerId: string, districtId: string, deliveredAt: Date | null) {
  const driverUser = await db.user.create({ data: { mobile: newMobile(), name: "T6 Driver", roles: ["BUYER", "DRIVER"] } });
  const driver = await db.driver.create({ data: { supplierId, userId: driverUser.id, vehiclePlate: "TST 600" } });
  const order = await db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId, supplierId, type: "DONATION", status: deliveredAt ? "CONFIRMED_BY_BOTH" : "OUT_FOR_DELIVERY",
      districtId, lat: PIN.lat, lng: PIN.lng, windowStart: new Date(), windowEnd: new Date(Date.now() + 3_600_000), acceptBy: new Date(Date.now() + 7_200_000),
      goodsHalalas: 1_000, deliveryHalalas: 100, totalHalalas: 1_100, vatHalalas: 143, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
    },
  });
  const delivery = await db.delivery.create({
    data: {
      orderId: order.id, driverId: driver.id, status: deliveredAt ? "DELIVERED" : "FAILED", attempts: 1,
      deliveredAt, pinLat: PIN.lat + 0.001, pinLng: PIN.lng + 0.001, pinNote: "test pin",
    },
  });
  await db.deliveryAttempt.create({ data: { deliveryId: delivery.id, n: 1, driverId: driver.id, startedAt: new Date(), lat: PIN.lat, lng: PIN.lng } });
  if (!deliveredAt) {
    // A never-delivered (FAILED) delivery is judged "stale" by its own last activity — backdate that
    // directly since @updatedAt always stamps "now" on create/update through the client.
    await db.$executeRaw`UPDATE "Delivery" SET "updatedAt" = ${new Date(Date.now() - 31 * DAY)} WHERE id = ${delivery.id}`;
  }
  return delivery;
}

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T6 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED" } });
  await db.order.updateMany({
    where: { supplier: { legalNameEn: { startsWith: "T6 " } }, status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "ESCALATED", "FAILED_ATTEMPT"] } },
    data: { status: "CANCELLED", cancelReason: "verify cleanup" },
  });
}

async function main() {
  console.log(`Verifying slice 6 against ${BASE}`);
  const health0 = await fetch(BASE + "/api/v1/health").catch(() => null);
  if (!health0) {
    console.error("The dev server is not reachable. Start it with `npm run dev`.");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup();

  const anon = new Client();
  const districts = (await anon.get("/api/v1/districts")).json.districts as { id: string; slug: string }[];
  const az = districts.find((d) => d.slug === "al-aziziyah")!;

  section("A. Fixtures");
  await resetStaff(OPS_MOBILE);
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: { roles: ["BUYER", "ADMIN_OPS"] }, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);

  const buyerC = new Client();
  const buyerMobile = newMobile();
  await login(buyerC, buyerMobile);
  await buyerC.patch("/api/v1/me", { name: "Salem Alharbi" });
  const buyerId = (await db.user.findUniqueOrThrow({ where: { mobile: buyerMobile } })).id;

  // ───── B. Health endpoint ─────
  section("B. Health endpoint");
  const health = await anon.get("/api/v1/health");
  check("Publicly reachable, no sign-in needed", health.status === 200);
  check("Reports the database as reachable", health.json.ok === true && health.json.db === true);
  check("Never leaks anything beyond booleans/timing", Object.keys(health.json).every((k) => ["ok", "db", "jobsRunningHere", "tookMs"].includes(k)));

  // ───── C. Generic rate limiter ─────
  section("C. Rate limiting on write endpoints (order/review/dispute/invoice actions)");
  // openDeliveryDispute() checks the rate limit before anything else, so hammering a bogus order id
  // is a cheap way to exercise it without placing 11 real orders through the full delivery flow.
  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    lastStatus = (await buyerC.post("/api/v1/orders/does-not-exist/report-problem", { category: "OTHER", note: "rate limit probe" })).status;
  }
  check("The 11th report-problem call in an hour is throttled, not just 404'd", lastStatus === 429, lastStatus);
  const rlBody = await buyerC.post("/api/v1/orders/does-not-exist/report-problem", { category: "OTHER", note: "rate limit probe" });
  check("…with the RATE_LIMITED error code", rlBody.json?.error?.code === "RATE_LIMITED", rlBody.json);

  // ───── D. Document-expiry notices (documents.expiry_check) ─────
  section("D. Document-expiry notices");
  const X = await makeSupplier("T6 X");
  const soonDoc = await db.supplierDocument.create({
    data: { supplierId: X.id, kind: "CR", fileKey: "x", originalName: "x.pdf", mime: "application/pdf", size: 10, sha256: rnd(20), status: "VERIFIED", expiresAt: new Date(Date.now() + 5 * DAY) },
  });
  const expiredDoc = await db.supplierDocument.create({
    data: { supplierId: X.id, kind: "VAT_CERT", fileKey: "y", originalName: "y.pdf", mime: "application/pdf", size: 10, sha256: rnd(20), status: "VERIFIED", expiresAt: new Date(Date.now() - 2 * DAY) },
  });
  const pass1 = await sendDocumentExpiryNotices();
  check("A document expiring within 14 days gets one warning", pass1.warned >= 1 && (await supplierInApp(X.id, "document.expiring_soon")) === 1);
  check("An already-expired document gets its own notice", pass1.expired >= 1 && (await supplierInApp(X.id, "document.expired")) === 1);
  const pass2 = await sendDocumentExpiryNotices();
  check("Running it again does not re-notify the same documents (idempotent)", (await supplierInApp(X.id, "document.expiring_soon")) === 1 && (await supplierInApp(X.id, "document.expired")) === 1, pass2);
  const attention = await docsNeedingAttention();
  check("Both documents show up on the admin dashboard's queue", attention.some((d) => d.id === soonDoc.id && !d.expired) && attention.some((d) => d.id === expiredDoc.id && d.expired));

  // ───── E. Agreement re-acceptance nudges (agreements.reacceptance_check) ─────
  section("E. Agreement re-acceptance nudges");
  const opsUser = await db.user.findUniqueOrThrow({ where: { mobile: OPS_MOBILE } });
  const admin = { id: opsUser.id, roles: opsUser.roles };
  // TermsDocument rows are append-only (a database trigger forbids deleting them), so an earlier run's
  // own upcoming version can still legitimately be "the" one getUpcomingTerms() returns here — this
  // script never controls that. Publish today's version anyway (it's still a real, valid new version)
  // and assert something that stays true regardless of *which* upcoming version X gets nudged about.
  await publishTerms(admin, {
    type: "SUPPLIER_AGREEMENT", version: `1.1-t6-${rnd(6)}`, titleAr: "اتفاقية المورّد", titleEn: "Supplier Agreement",
    bodyAr: "نص تجريبي ".repeat(20), bodyEn: "Test body text. ".repeat(20), noticeDays: 30, effectiveFrom: new Date(Date.now() + 31 * DAY),
  }, { ip: null, ua: null });
  const passE1 = await sendReacceptanceNudges();
  check("A supplier who only accepted the old version is nudged about the new one", passE1.notified >= 1 && (await inApp(X.userId, "terms.reacceptance_needed")) === 1);
  const passE2 = await sendReacceptanceNudges();
  check("Running it again does not re-notify the same document (idempotent)", (await inApp(X.userId, "terms.reacceptance_needed")) === 1, passE2);
  const nudge = await db.notification.findFirstOrThrow({ where: { userId: X.userId, event: "terms.reacceptance_needed" } });
  const nudgedDocId = (nudge.payload as { termsDocumentId?: string } | null)?.termsDocumentId;
  const nudgedDoc = nudgedDocId ? await db.termsDocument.findUnique({ where: { id: nudgedDocId } }) : null;
  check(
    "It names a real, not-yet-accepted SUPPLIER_AGREEMENT version — never one X has already accepted",
    !!nudgedDoc && nudgedDoc.type === "SUPPLIER_AGREEMENT" && !(await db.termsAcceptance.findFirst({ where: { termsDocumentId: nudgedDoc.id, supplierId: X.id } })),
  );

  // ───── F. Driver-location retention purge (privacy.purge_location_pings) ─────
  section("F. Driver-location retention (R10: 30-day purge)");
  const staleDelivery = await makeStaleDelivery(X.id, buyerId, az.id, new Date(Date.now() - 31 * DAY));
  const freshDelivery = await makeStaleDelivery(X.id, buyerId, az.id, new Date(Date.now() - 5 * DAY));
  const staleFailedDelivery = await makeStaleDelivery(X.id, buyerId, az.id, null);
  const staleProof = await db.proofOfDelivery.create({
    data: {
      deliveryId: staleDelivery.id, attempt: 1, lat: PIN.lat, lng: PIN.lng, radiusM: 150, radiusOk: true,
      brandPhotoOk: true, recipientOtpOk: true, deliveredGoodsHalalas: 1000, deliveredTotalHalalas: 1100,
      deliveredVatHalalas: 143, deliveredPacketEqMilli: 1000, deliveredFeeHalalas: 50, confirmedAtDevice: new Date(),
    },
  });
  const purge1 = await purgeStaleDriverLocations();
  check("A pin older than 30 days since delivery is purged", purge1.deliveriesPurged >= 1 && (await db.delivery.findUniqueOrThrow({ where: { id: staleDelivery.id } })).pinLat === null);
  check("…and its attempt's GPS reading too", (await db.deliveryAttempt.findFirstOrThrow({ where: { deliveryId: staleDelivery.id } })).lat === null);
  check("A stale FAILED (never-delivered) delivery's pin is purged too", (await db.delivery.findUniqueOrThrow({ where: { id: staleFailedDelivery.id } })).pinLat === null);
  check("A recent delivery's pin is left alone — still inside the retention window", (await db.delivery.findUniqueOrThrow({ where: { id: freshDelivery.id } })).pinLat !== null);
  check("Proof-of-delivery GPS is evidence, not a navigation ping — this job never touches it", (await db.proofOfDelivery.findUniqueOrThrow({ where: { id: staleProof.id } })).lat === PIN.lat);
  const purge2 = await purgeStaleDriverLocations();
  check("Running it again finds nothing left to purge for the same rows (idempotent)", purge2.deliveriesPurged === 0 || (await db.delivery.count({ where: { id: { in: [staleDelivery.id, staleFailedDelivery.id] }, pinLat: { not: null } } })) === 0);

  // ───── G. Unified admin dashboard ─────
  section("G. Unified admin dashboard");
  const dash = await ops.get("/admin");
  check("The admin dashboard renders for an ops admin (smoke test of every new query)", dash.status === 200);
  const dashText = dash.text;
  check("It mentions the expiring document's supplier somewhere on the page", dashText.includes(X.name));

  // ───── H. Access control ─────
  section("H. Access control");
  const anonDash = await anon.get("/admin");
  check("Anonymous visitors cannot reach the admin dashboard (redirected to sign in)", anonDash.status !== 200);
  check("Anonymous visitors CAN still reach the health check (it must work before anyone signs in)", (await anon.get("/api/v1/health")).status === 200);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
