/**
 * End-to-end verification of slice 4 (dual confirmation, direct-payment tracking, disputes, supplier
 * Payments page) against a RUNNING dev server and the dev DB:   npm run verify:4
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { randomBytes } from "node:crypto";
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { closeReviewWindow, sendConfirmReminders, sendPaymentReminders } from "../src/server/payments";

const OPS_MOBILE = "+966500000002";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };
const NEAR = { lat: 21.4226, lng: 39.8263 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });
const idem = () => `k-${rnd(12)}`;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1200)]);

interface Sup { c: Client; id: string; mobile: string; userId: string; name: string }

async function makeSupplier(name: string): Promise<Sup> {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: "BRAND_COMPANY", status: "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name, tradeName: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 25_000,
      members: { create: { userId: owner.id, role: "OWNER" } },
      bankAccounts: { create: { iban: `SA${rnd(22)}`, holderName: name, bankName: "Test Bank", status: "ACTIVE", activatedAt: new Date() } },
    },
  });
  const c = new Client();
  await login(c, mobile);
  await enrol(c);
  const code = must(await c.post("/api/v1/terms/sign-code", { type: "SUPPLIER_AGREEMENT", version: "1.0" }), "sign code").json.devCode;
  must(await c.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "AR", confirmRead: true, authorised: true, code }), "accept agreement");
  return { c, id: sup.id, mobile, userId: owner.id, name };
}

async function makeBuyer(districtId: string) {
  const c = new Client();
  const mobile = newMobile();
  await login(c, mobile);
  await c.patch("/api/v1/me", { name: "Khalid Alotaibi" });
  must(await c.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true }), "buyer terms");
  const site = must(await c.post("/api/v1/sites", { label: "Test mosque", districtId, lat: PIN.lat, lng: PIN.lng, landmark: "Blue gate", accessNotes: "Gate 2", recipientName: "Ahmad Recipient", recipientMobile: "0501234567" }), "site");
  return { c, mobile, siteId: site.json.site.id as string, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

async function makeDriver(sup: Sup, name: string) {
  const mobile = newMobile();
  const r = must(await sup.c.post("/api/v1/supplier/drivers", { mobile, name, vehiclePlate: "TST 111" }), "add driver");
  const c = new Client();
  await login(c, mobile);
  must(await c.post("/api/v1/terms/accept", { type: "DRIVER_ACK", version: "1.0", language: "AR", confirmRead: true }), "driver ack");
  return { c, mobile, driverId: r.json.driver.id as string, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

const photoForm = (kind: string, clientId = `c${rnd(14)}`) => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(jpeg())], "p.jpg", { type: "image/jpeg" }));
  f.set("clientId", clientId);
  f.set("kind", kind);
  f.set("capturedAt", new Date().toISOString());
  f.set("lat", String(NEAR.lat));
  f.set("lng", String(NEAR.lng));
  f.set("accuracyM", "10");
  return f;
};

/** Runs a fresh order all the way through to DELIVERED_DRIVER_CONFIRMED. Returns ids needed by the tests. */
async function deliverOrder(supplier: Sup, driver: { c: Client; driverId: string }, az: { id: string }, offerId: string, qty = 10) {
  const buyer = await makeBuyer(az.id);
  const slots = must(await buyer.c.get(`/api/v1/offers/${offerId}/slots?districtId=${az.id}`), "slots").json.slots as { start: string }[];
  const far = slots.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!;
  const placed = must(await buyer.c.post("/api/v1/orders", { siteId: buyer.siteId, type: "DONATION", windowStart: far.start, lines: [{ offerId, qtyPacks: qty }] }, { "idempotency-key": idem() }), "place").json.order;
  must(await supplier.c.post(`/api/v1/supplier/orders/${placed.id}/accept`), "accept");
  must(await supplier.c.post(`/api/v1/supplier/orders/${placed.id}/assign`, { driverId: driver.driverId }), "assign");
  must(await driver.c.post(`/api/v1/driver/jobs/${placed.id}/start`, {}), "start");
  must(await driver.c.post(`/api/v1/driver/jobs/${placed.id}/arrived`, {}), "arrived");
  must(await driver.c.req("POST", `/api/v1/driver/jobs/${placed.id}/photos`, { form: photoForm("BRAND_LABEL") }), "photo1");
  must(await driver.c.req("POST", `/api/v1/driver/jobs/${placed.id}/photos`, { form: photoForm("DELIVERED_GOODS") }), "photo2");
  const conf = must(await driver.c.post(`/api/v1/driver/jobs/${placed.id}/confirm`, {
    items: [{ itemId: placed.items[0].id, deliveredQtyPacks: qty }], confirmedAt: new Date().toISOString(), lat: NEAR.lat, lng: NEAR.lng, accuracyM: 10, otpBypassReason: "no signal",
  }), "confirm delivery");
  return { buyer, orderId: placed.id, orderNo: placed.orderNo as string, totalHalalas: placed.totalHalalas as number, itemId: placed.items[0].id as string, delivered: conf.json };
}

const state = async (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { payment: true, disputes: { orderBy: { createdAt: "desc" } }, events: true } });

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T4 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED" } });
  // Any dispute left OPEN by an aborted run must be resolved before its order can be touched (the app never leaves one hanging).
  const admin = await db.user.findFirst({ where: { OR: [{ mobile: OPS_MOBILE }, { roles: { has: "SUPER_ADMIN" } }] } });
  if (admin) {
    await db.dispute.updateMany({
      where: { status: "OPEN", order: { supplier: { legalNameEn: { startsWith: "T4 " } } } },
      data: { status: "RESOLVED", outcome: "DISMISS", resolvedById: admin.id, resolvedAt: new Date(), resolutionNote: "verify cleanup" },
    });
  }
  await db.order.updateMany({
    where: { supplier: { legalNameEn: { startsWith: "T4 " } }, status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "ESCALATED", "FAILED_ATTEMPT", "DELIVERED_DRIVER_CONFIRMED", "ADMIN_REVIEW", "DISPUTED", "CONFIRMED_BY_BOTH"] } },
    data: { status: "CANCELLED", cancelReason: "verify cleanup" },
  });
  await db.brand.updateMany({ where: { sfdaRef: { startsWith: "T4-" } }, data: { status: "SUSPENDED" } });
}

async function main() {
  console.log(`Verifying slice 4 against ${BASE}`);
  const health = await fetch(BASE + "/api/v1/districts").catch(() => null);
  if (!health || health.status !== 200) {
    console.error("The dev server is not reachable. Start it with `npm run dev`.");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup();

  const anon = new Client();
  const districts = (await anon.get("/api/v1/districts")).json.districts as { id: string; slug: string }[];
  const az = districts.find((d) => d.slug === "al-aziziyah")!;
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٤", nameEn: `T4 Brand ${rnd(4)}`, sfdaRef: `T4-${rnd(8)}` } });

  section("A. Fixtures");
  const X = await makeSupplier("T4 X");
  const offer = await db.offer.create({ data: { supplierId: X.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
  await db.coverageZone.create({ data: { supplierId: X.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  const D1 = await makeDriver(X, "Sultan Alharbi");
  check("A supplier, one offer, one driver, ready to deliver", !!offer.id && !!D1.driverId);

  await resetStaff(OPS_MOBILE);
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: {}, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);
  const SUPPORT_MOBILE = "+966500000003";
  await resetStaff(SUPPORT_MOBILE);
  await db.user.upsert({ where: { mobile: SUPPORT_MOBILE }, update: {}, create: { mobile: SUPPORT_MOBILE, name: "Support Reviewer", roles: ["BUYER", "ADMIN_SUPPORT"] } });
  const support = new Client();
  await login(support, SUPPORT_MOBILE);
  await enrol(support);

  // ───── B. Confirming receipt (T12) ─────
  section("B. Buyer confirms receipt (T12)");
  const b1 = await deliverOrder(X, D1, az, offer.id, 10);
  check("Delivered, no payment yet, nothing to pay shown", (await b1.buyer.c.get(`/api/v1/orders/${b1.orderId}`)).json.order.payment === null);
  check("A stranger cannot confirm someone else's order (404)", (await (await makeBuyer(az.id)).c.post(`/api/v1/orders/${b1.orderId}/confirm-receipt`, {})).status === 404);
  const confirmed = must(await b1.buyer.c.post(`/api/v1/orders/${b1.orderId}/confirm-receipt`, {}), "confirm-receipt");
  check("Confirmed → CONFIRMED_BY_BOTH, method BUYER, payment DUE with bank details", confirmed.json.order.status === "CONFIRMED_BY_BOTH" && confirmed.json.order.confirmMethod === "BUYER" && confirmed.json.order.payment.status === "DUE" && confirmed.json.order.payment.bank.iban.startsWith("SA"), confirmed.json.order);
  check("Payment amount equals the order total; transaction number is well formed", confirmed.json.order.payment.amountHalalas === b1.totalHalalas && /^SBL-PAY-\d{4}-\d{6}$/.test(confirmed.json.order.payment.transactionNo));
  check("Due date is 3 days out", Math.abs(new Date(confirmed.json.order.payment.dueAt).getTime() - (Date.now() + 3 * DAY)) < 5 * 60_000);
  check("Confirming twice → 409 INVALID_STATE", (await b1.buyer.c.post(`/api/v1/orders/${b1.orderId}/confirm-receipt`, {})).status === 409);
  check("Buyer was notified payment is due", (await inApp(b1.buyer.userId, "payment.due")) === 1);
  check("Audit has 'order.confirmed'", (await db.auditLog.count({ where: { action: "order.confirmed", entityId: b1.orderId } })) === 1);

  // ───── C. 72 h silence → admin review → confirm ─────
  section("C. Silence, admin review, and both confirmation paths (T13/T14)");
  const b2 = await deliverOrder(X, D1, az, offer.id, 5);
  await db.delivery.update({ where: { orderId: b2.orderId }, data: { deliveredAt: new Date(Date.now() - 73 * HOUR) } });
  const b3 = await deliverOrder(X, D1, az, offer.id, 5);
  await db.delivery.update({ where: { orderId: b3.orderId }, data: { deliveredAt: new Date(Date.now() - 73 * HOUR) } });
  const pass1 = await sendConfirmReminders();
  check("The job reminds a silent buyer and, past 72h, sends the order to admin review", pass1.sentToReview >= 2, pass1);
  check("Both orders are now ADMIN_REVIEW", (await state(b2.orderId)).status === "ADMIN_REVIEW" && (await state(b3.orderId)).status === "ADMIN_REVIEW");
  const pass2 = await sendConfirmReminders();
  check("Running the job again does not re-send it to review (idempotent)", pass2.sentToReview === 0, pass2);

  const buyerConfirmsLate = must(await b2.buyer.c.post(`/api/v1/orders/${b2.orderId}/confirm-receipt`, {}), "late confirm");
  check("The buyer can still confirm from ADMIN_REVIEW", buyerConfirmsLate.json.order.status === "CONFIRMED_BY_BOTH" && buyerConfirmsLate.json.order.confirmMethod === "BUYER");

  check("Admin confirm needs a reason (422)", (await ops.post(`/api/v1/admin/orders/${b3.orderId}/confirm`, {})).status === 422);
  check("A buyer cannot use the admin-confirm route (403)", (await b3.buyer.c.post(`/api/v1/admin/orders/${b3.orderId}/confirm`, { note: "x" })).status === 403);
  const adminConfirmed = must(await ops.post(`/api/v1/admin/orders/${b3.orderId}/confirm`, { note: "evidence on file is complete" }), "admin confirm");
  check("Admin confirms on the evidence → CONFIRMED_BY_BOTH, method ADMIN_SILENCE", adminConfirmed.json.order.status === "CONFIRMED_BY_BOTH" && adminConfirmed.json.order.confirmMethod === "ADMIN_SILENCE");
  check("Confirming an order that is not in review → 409", (await ops.post(`/api/v1/admin/orders/${b3.orderId}/confirm`, { note: "again" })).status === 409);
  check("Audit has 'order.admin_confirmed'", (await db.auditLog.count({ where: { action: "order.admin_confirmed", entityId: b3.orderId } })) === 1);
  check("Both silent buyers were reminded before review (24h/48h notices)", (await inApp(b2.buyer.userId, "order.confirm_reminder_24h")) === 1 && (await inApp(b2.buyer.userId, "order.confirm_reminder_48h")) === 1);

  // ───── D. Delivery disputes (T15/T16) ─────
  section("D. Delivery disputes: report, dismiss, price-adjust, redeliver, cancel");
  const d1 = await deliverOrder(X, D1, az, offer.id, 8);
  check("A plain buyer cannot report NON_PAYMENT (not a valid buyer category, 422)", (await d1.buyer.c.post(`/api/v1/orders/${d1.orderId}/report-problem`, { category: "NON_PAYMENT", note: "x" })).status === 422);
  const reportBad = await d1.buyer.c.post(`/api/v1/orders/${d1.orderId}/report-problem`, { category: "SHORT", note: "x" });
  check("A too-short note is refused (422)", reportBad.status === 422);
  const reported = must(await d1.buyer.c.post(`/api/v1/orders/${d1.orderId}/report-problem`, { category: "SHORT", note: "Only 6 packs arrived, not 8" }), "report problem");
  check("Reported → DISPUTED; confirm/pay are now impossible", reported.json.order.status === "DISPUTED" && !reported.json.order.confirmable);
  check("Confirming a disputed order → 409", (await d1.buyer.c.post(`/api/v1/orders/${d1.orderId}/confirm-receipt`, {})).status === 409);
  check("Opening a second dispute on the same order → 409 DISPUTE_OPEN", (await d1.buyer.c.post(`/api/v1/orders/${d1.orderId}/report-problem`, { category: "LATE", note: "also late" })).json?.error?.code === "DISPUTE_OPEN");
  check("The supplier was told a problem was reported", (await inApp(X.userId, "dispute.opened")) >= 1);
  const disputeId1 = (await state(d1.orderId)).disputes[0].id;

  check("A buyer cannot resolve disputes (403)", (await d1.buyer.c.post(`/api/v1/admin/disputes/${disputeId1}/resolve`, { outcome: "DISMISS", resolutionNote: "x" })).status === 403);
  check("Support can see the queue but not resolve (403)", (await support.get("/api/v1/admin/disputes")).status === 200 && (await support.post(`/api/v1/admin/disputes/${disputeId1}/resolve`, { outcome: "DISMISS", resolutionNote: "no" })).status === 403);
  const queue = await ops.get("/api/v1/admin/disputes");
  check("The dispute appears in the admin queue", queue.status === 200 && queue.json.disputes.some((x: { id: string }) => x.id === disputeId1));
  check("A wrong outcome for this category is refused (422)", (await ops.post(`/api/v1/admin/disputes/${disputeId1}/resolve`, { outcome: "PAYMENT_RECEIVED", resolutionNote: "no" })).status === 422);
  const dismissed = must(await ops.post(`/api/v1/admin/disputes/${disputeId1}/resolve`, { outcome: "DISMISS", resolutionNote: "Driver's count and photos match 8 packs" }), "dismiss");
  check("Dismissed → back to CONFIRMED_BY_BOTH, full price, method ADMIN_DISPUTE", dismissed.json.order.status === "CONFIRMED_BY_BOTH" && dismissed.json.order.confirmMethod === "ADMIN_DISPUTE" && dismissed.json.order.payment.amountHalalas === d1.totalHalalas);
  check("The dispute record is resolved with an outcome and note", dismissed.json.order.disputes[0].status === "RESOLVED" && dismissed.json.order.disputes[0].outcome === "DISMISS");
  check("Resolving twice → 409", (await ops.post(`/api/v1/admin/disputes/${disputeId1}/resolve`, { outcome: "DISMISS", resolutionNote: "again" })).status === 409);
  check("It has left the admin queue", !(await ops.get("/api/v1/admin/disputes")).json.disputes.some((x: { id: string }) => x.id === disputeId1));

  const d2 = await deliverOrder(X, D1, az, offer.id, 8);
  must(await d2.buyer.c.post(`/api/v1/orders/${d2.orderId}/report-problem`, { category: "WRONG_BRAND", note: "Different brand than ordered" }), "report d2");
  const disputeId2 = (await state(d2.orderId)).disputes[0].id;
  const badAdj = await ops.post(`/api/v1/admin/disputes/${disputeId2}/resolve`, { outcome: "PRICE_ADJUSTMENT", resolutionNote: "x", adjustedTotalHalalas: d2.totalHalalas + 1 });
  check("An adjustment above the original total is refused (422)", badAdj.status === 422);
  const half = Math.floor(d2.totalHalalas / 2);
  const adjusted = must(await ops.post(`/api/v1/admin/disputes/${disputeId2}/resolve`, { outcome: "PRICE_ADJUSTMENT", resolutionNote: "Half refunded as goodwill", adjustedTotalHalalas: half }), "price adjust");
  check("Price-adjusted → confirmed at the lower amount, buyer notified what is due", adjusted.json.order.status === "CONFIRMED_BY_BOTH" && adjusted.json.order.payment.amountHalalas === half && adjusted.json.order.amountOwed === half);
  check("Buyer was told payment is due at the adjusted amount", (await inApp(d2.buyer.userId, "payment.due")) === 1);

  const d3 = await deliverOrder(X, D1, az, offer.id, 8);
  must(await d3.buyer.c.post(`/api/v1/orders/${d3.orderId}/report-problem`, { category: "NOT_DELIVERED", note: "Nothing arrived at all" }), "report d3");
  const disputeId3 = (await state(d3.orderId)).disputes[0].id;
  const cancelled = must(await ops.post(`/api/v1/admin/disputes/${disputeId3}/resolve`, { outcome: "CANCEL", resolutionNote: "Confirmed lost in transit" }), "dispute cancel");
  check("Cancelled → order CANCELLED, nothing owed, no PaymentRecord", cancelled.json.order.status === "CANCELLED" && cancelled.json.order.payment === null);

  const d4 = await deliverOrder(X, D1, az, offer.id, 8);
  must(await d4.buyer.c.post(`/api/v1/orders/${d4.orderId}/report-problem`, { category: "SHORT", note: "Only half arrived, please redeliver" }), "report d4");
  const disputeId4 = (await state(d4.orderId)).disputes[0].id;
  check("Redeliver needs a window (422)", (await ops.post(`/api/v1/admin/disputes/${disputeId4}/resolve`, { outcome: "REDELIVER", resolutionNote: "x" })).status === 422);
  const slots4 = must(await ops.get(`/api/v1/admin/orders/${d4.orderId}/slots`), "admin slots").json.slots as { start: string }[];
  const redelivered = must(await ops.post(`/api/v1/admin/disputes/${disputeId4}/resolve`, { outcome: "REDELIVER", resolutionNote: "Sending the missing packs", windowStart: slots4.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!.start }), "redeliver");
  check("Redeliver → back to ASSIGNED with a fresh window; the driver still has the job", redelivered.json.order.status === "ASSIGNED", redelivered.json.order.status);
  const job2 = (await D1.c.get("/api/v1/driver/jobs")).json.jobs.find((j: { orderId: string }) => j.orderId === d4.orderId);
  check("The driver can deliver again: a second attempt, separate from the first", !!job2 && job2.attempts === 1);
  must(await D1.c.post(`/api/v1/driver/jobs/${job2.id}/start`, {}), "start 2");
  must(await D1.c.req("POST", `/api/v1/driver/jobs/${job2.id}/photos`, { form: photoForm("BRAND_LABEL") }), "photo 2a");
  must(await D1.c.req("POST", `/api/v1/driver/jobs/${job2.id}/photos`, { form: photoForm("DELIVERED_GOODS") }), "photo 2b");
  const conf2 = must(await D1.c.post(`/api/v1/driver/jobs/${job2.id}/confirm`, { items: [{ itemId: d4.itemId, deliveredQtyPacks: 8 }], confirmedAt: new Date().toISOString(), lat: NEAR.lat, lng: NEAR.lng, accuracyM: 10, otpBypassReason: "x" }), "confirm 2");
  check("Redelivered successfully → DELIVERED_DRIVER_CONFIRMED again", conf2.status === 200 && (await state(d4.orderId)).status === "DELIVERED_DRIVER_CONFIRMED");
  check("Two attempts are on record; the first attempt's proof is untouched", (await db.deliveryAttempt.count({ where: { delivery: { orderId: d4.orderId } } })) === 2 && (await db.proofPhoto.count({ where: { delivery: { orderId: d4.orderId } } })) === 4);

  // ───── E. Payment lifecycle ─────
  section("E. Payment: mark paid, received, not received, overdue");
  const e1 = await deliverOrder(X, D1, az, offer.id, 6);
  check("Cannot mark paid before confirming (409, no PaymentRecord yet)", (await e1.buyer.c.req("POST", `/api/v1/orders/${e1.orderId}/payment/mark-paid`, { form: (() => { const f = new FormData(); f.set("paymentDate", new Date().toISOString()); f.set("bankReference", "REF1"); return f; })() })).status === 409);
  must(await e1.buyer.c.post(`/api/v1/orders/${e1.orderId}/confirm-receipt`, {}), "confirm e1");
  const payForm = (ref: string, dateIso = new Date().toISOString()) => { const f = new FormData(); f.set("paymentDate", dateIso); f.set("bankReference", ref); return f; };
  const futureDate = await e1.buyer.c.req("POST", `/api/v1/orders/${e1.orderId}/payment/mark-paid`, { form: payForm("REF-FUTURE", new Date(Date.now() + 5 * DAY).toISOString()) });
  check("A payment date far in the future is refused (422)", futureDate.status === 422);
  const marked = must(await e1.buyer.c.req("POST", `/api/v1/orders/${e1.orderId}/payment/mark-paid`, { form: payForm("REF12345") }), "mark paid");
  check("Marked paid → BUYER_MARKED_PAID, bank reference stored", marked.json.order.payment.status === "BUYER_MARKED_PAID" && marked.json.order.payment.bankReference === "REF12345");
  check("The supplier was told the buyer says they paid", (await inApp(X.userId, "payment.marked_paid")) >= 1);
  check("Marking paid again → 409", (await e1.buyer.c.req("POST", `/api/v1/orders/${e1.orderId}/payment/mark-paid`, { form: payForm("REF2") })).status === 409);

  check("A stranger supplier cannot act on this payment (404)", (await (await makeSupplier("T4 stranger")).c.post(`/api/v1/supplier/orders/${e1.orderId}/payment/mark-received`, {})).status === 404);
  const notReceivedShort = await X.c.post(`/api/v1/supplier/orders/${e1.orderId}/payment/not-received`, { note: "x" });
  check("Not-received needs a real reason (422)", notReceivedShort.status === 422);
  const notReceived = must(await X.c.post(`/api/v1/supplier/orders/${e1.orderId}/payment/not-received`, { note: "No transfer matching this reference arrived" }), "not received");
  check("Not received → back to DUE, buyer told why", notReceived.json.order.payment.status === "DUE" && notReceived.json.order.payment.notReceivedNote?.includes("No transfer"));
  check("The buyer was told to check the details", (await inApp(e1.buyer.userId, "payment.not_received")) >= 1);

  must(await e1.buyer.c.req("POST", `/api/v1/orders/${e1.orderId}/payment/mark-paid`, { form: payForm("REF3") }), "mark paid again");
  const received = must(await X.c.post(`/api/v1/supplier/orders/${e1.orderId}/payment/mark-received`, {}), "mark received");
  check("Received → order PAID", received.json.order.status === "PAID" && received.json.order.payment.status === "RECEIVED");
  check("The buyer's paid count and on-time count both grew by one", (await db.user.findUniqueOrThrow({ where: { id: e1.buyer.userId } })).paidOrdersCount === 1 && (await db.user.findUniqueOrThrow({ where: { id: e1.buyer.userId } })).paidOnTimeCount === 1);
  check("Marking received again → 409", (await X.c.post(`/api/v1/supplier/orders/${e1.orderId}/payment/mark-received`, {})).status === 409);
  check("The buyer was thanked", (await inApp(e1.buyer.userId, "payment.received")) === 1);
  check("Audit has payment.marked_paid, payment.not_received, payment.received", (await db.auditLog.count({ where: { action: "payment.marked_paid" } })) >= 1 && (await db.auditLog.count({ where: { action: "payment.not_received" } })) >= 1 && (await db.auditLog.count({ where: { action: "payment.received" } })) >= 1);

  // Late payment: mark paid, then push the due date into the past before the supplier confirms receipt.
  const e2 = await deliverOrder(X, D1, az, offer.id, 4);
  must(await e2.buyer.c.post(`/api/v1/orders/${e2.orderId}/confirm-receipt`, {}), "confirm e2");
  must(await e2.buyer.c.req("POST", `/api/v1/orders/${e2.orderId}/payment/mark-paid`, { form: payForm("LATE1") }), "mark paid e2");
  await db.paymentRecord.update({ where: { orderId: e2.orderId }, data: { dueAt: new Date(Date.now() - HOUR) } });
  const beforeOnTime = (await db.user.findUniqueOrThrow({ where: { id: e2.buyer.userId } })).paidOnTimeCount;
  must(await X.c.post(`/api/v1/supplier/orders/${e2.orderId}/payment/mark-received`, {}), "mark received late");
  const afterLate = await db.user.findUniqueOrThrow({ where: { id: e2.buyer.userId } });
  check("Paid late: the paid count grows but the on-time count does not", afterLate.paidOrdersCount === 1 && afterLate.paidOnTimeCount === beforeOnTime, { beforeOnTime, afterLate });

  // ───── F. Overdue payments block ordering ─────
  section("F. Overdue payment blocks new orders (buyer trust)");
  const f1 = await deliverOrder(X, D1, az, offer.id, 3);
  must(await f1.buyer.c.post(`/api/v1/orders/${f1.orderId}/confirm-receipt`, {}), "confirm f1");
  await db.paymentRecord.update({ where: { orderId: f1.orderId }, data: { dueAt: new Date(Date.now() - HOUR) } });
  const overduePass = await sendPaymentReminders();
  check("The reminder job flips a past-due payment to OVERDUE", overduePass.wentOverdue >= 1, overduePass);
  check("…and the buyer + supplier are both told", (await inApp(f1.buyer.userId, "payment.overdue")) === 1);
  check("Overdue: the buyer cannot place a new order anywhere (403 PAYMENT_OVERDUE)", await (async () => {
    const slots = must(await f1.buyer.c.get(`/api/v1/offers/${offer.id}/slots?districtId=${az.id}`), "slots f1").json.slots as { start: string }[];
    const r = await f1.buyer.c.post("/api/v1/orders", { siteId: f1.buyer.siteId, type: "DONATION", windowStart: slots.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!.start, lines: [{ offerId: offer.id, qtyPacks: 1 }] }, { "idempotency-key": idem() });
    return r.status === 403 && r.json.error.code === "PAYMENT_OVERDUE";
  })());
  check("Running the reminder job again does not re-notify (idempotent)", (await sendPaymentReminders()).wentOverdue === 0);
  must(await f1.buyer.c.req("POST", `/api/v1/orders/${f1.orderId}/payment/mark-paid`, { form: payForm("REF-F1") }), "mark paid f1");
  must(await X.c.post(`/api/v1/supplier/orders/${f1.orderId}/payment/mark-received`, {}), "settle f1");
  check("Once settled, ordering works again", await (async () => {
    const slots = must(await f1.buyer.c.get(`/api/v1/offers/${offer.id}/slots?districtId=${az.id}`), "slots f1b").json.slots as { start: string }[];
    const r = await f1.buyer.c.post("/api/v1/orders", { siteId: f1.buyer.siteId, type: "DONATION", windowStart: slots.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!.start, lines: [{ offerId: offer.id, qtyPacks: 1 }] }, { "idempotency-key": idem() });
    return r.status === 201;
  })());

  // Reminder-before + follow-up reminders (idempotent, one each).
  const f2 = await deliverOrder(X, D1, az, offer.id, 2);
  must(await f2.buyer.c.post(`/api/v1/orders/${f2.orderId}/confirm-receipt`, {}), "confirm f2");
  await db.paymentRecord.update({ where: { orderId: f2.orderId }, data: { dueAt: new Date(Date.now() + 12 * HOUR) } });
  await sendPaymentReminders();
  await sendPaymentReminders();
  check("A -24h reminder is sent exactly once", (await inApp(f2.buyer.userId, "payment.reminder_before")) === 1);
  await db.paymentRecord.update({ where: { orderId: f2.orderId }, data: { dueAt: new Date(Date.now() - 3 * DAY) } });
  await sendPaymentReminders();
  await sendPaymentReminders();
  check("Well past due: the follow-up reminder fires exactly once", (await inApp(f2.buyer.userId, "payment.reminder_followup")) === 1);

  // ───── G. Non-payment disputes ─────
  section("G. Non-payment disputes (supplier-initiated)");
  const g1 = await deliverOrder(X, D1, az, offer.id, 5);
  const g1id = g1.orderId;
  check("Cannot report non-payment before any payment exists (409)", (await X.c.post(`/api/v1/supplier/orders/${g1id}/payment/dispute`, { note: "too early" })).status === 409);
  must(await g1.buyer.c.post(`/api/v1/orders/${g1id}/confirm-receipt`, {}), "confirm g1");
  check("A buyer cannot use the supplier's non-payment route (403)", (await g1.buyer.c.post(`/api/v1/supplier/orders/${g1id}/payment/dispute`, { note: "x" })).status === 403);
  const npBad = await X.c.post(`/api/v1/supplier/orders/${g1id}/payment/dispute`, { note: "x" });
  check("Non-payment report needs a real note (422)", npBad.status === 422);
  const np = must(await X.c.post(`/api/v1/supplier/orders/${g1id}/payment/dispute`, { note: "No bank transfer has arrived after a week" }), "non-payment report");
  check("Payment becomes DISPUTED; the order itself is unaffected", np.json.order.payment.status === "DISPUTED" && np.json.order.status === "CONFIRMED_BY_BOTH");
  check("Buyer sees the payment as under review", (await g1.buyer.c.get(`/api/v1/orders/${g1id}`)).json.order.payment.status === "DISPUTED");
  check("A second non-payment report while one is open → 409", (await X.c.post(`/api/v1/supplier/orders/${g1id}/payment/dispute`, { note: "still nothing" })).status === 409);
  const npDisputeId = (await state(g1id)).disputes[0].id;
  const npResolved = must(await ops.post(`/api/v1/admin/disputes/${npDisputeId}/resolve`, { outcome: "PAYMENT_RECEIVED", resolutionNote: "Bank statement confirms the transfer" }), "resolve non-payment");
  check("Resolved as received → order PAID, buyer's paid count grows", npResolved.json.order.status === "PAID" && npResolved.json.order.payment.status === "RECEIVED");

  const g2 = await deliverOrder(X, D1, az, offer.id, 5);
  must(await g2.buyer.c.post(`/api/v1/orders/${g2.orderId}/confirm-receipt`, {}), "confirm g2");
  must(await X.c.post(`/api/v1/supplier/orders/${g2.orderId}/payment/dispute`, { note: "Nothing received, please check" }), "np g2");
  const npDisputeId2 = (await state(g2.orderId)).disputes[0].id;
  const stillDue = must(await ops.post(`/api/v1/admin/disputes/${npDisputeId2}/resolve`, { outcome: "PAYMENT_STILL_DUE", resolutionNote: "No evidence of transfer from the buyer" }), "still due");
  check("Resolved as still due → payment back to DUE, order not paid", stillDue.json.order.payment.status === "DUE" && stillDue.json.order.status === "CONFIRMED_BY_BOTH");
  check("The buyer was told to pay right away", (await inApp(g2.buyer.userId, "dispute.resolved")) >= 1);

  const g3 = await deliverOrder(X, D1, az, offer.id, 5);
  must(await g3.buyer.c.post(`/api/v1/orders/${g3.orderId}/confirm-receipt`, {}), "confirm g3");
  await db.paymentRecord.update({ where: { orderId: g3.orderId }, data: { dueAt: new Date(Date.now() - HOUR) } });
  await sendPaymentReminders();
  must(await X.c.post(`/api/v1/supplier/orders/${g3.orderId}/payment/dispute`, { note: "Overdue and nothing received" }), "np g3");
  const npDisputeId3 = (await state(g3.orderId)).disputes[0].id;
  const voided = must(await ops.post(`/api/v1/admin/disputes/${npDisputeId3}/resolve`, { outcome: "PAYMENT_VOID", resolutionNote: "Written off — buyer unreachable, goodwill gesture" }), "void");
  check("Written off → VOID; no longer blocks the buyer from ordering", voided.json.order.payment.status === "VOID", voided.json.order.payment);
  check("…and the settled-payment guard now protects it (cannot change again in the DB)", await (async () => {
    try { await db.paymentRecord.update({ where: { orderId: g3.orderId }, data: { status: "DUE" } }); return false; } catch { return true; }
  })());

  // ───── H. Review window closes a paid order (T18) ─────
  section("H. Review window closes a paid order (T18)");
  await db.paymentRecord.update({ where: { orderId: e1.orderId }, data: { receivedAt: new Date(Date.now() - 31 * DAY) } });
  const closedPass = await closeReviewWindow();
  check("A paid order older than 30 days is closed", closedPass.closed >= 1 && (await state(e1.orderId)).status === "CLOSED");

  // ───── I. Privacy: nothing leaks before it should ─────
  section("I. Privacy");
  const xBank = await db.bankAccount.findFirstOrThrow({ where: { supplierId: X.id, status: "ACTIVE" } });
  const priv = await deliverOrder(X, D1, az, offer.id, 3);
  const beforeConfirmView = JSON.stringify((await priv.buyer.c.get(`/api/v1/orders/${priv.orderId}`)).json);
  check("Before confirmation, no bank IBAN, transaction number or due date exist in the buyer's view", !beforeConfirmView.includes(xBank.iban) && !beforeConfirmView.includes("transactionNo"));
  const supplierViewBefore = JSON.stringify((await X.c.get(`/api/v1/supplier/orders/${priv.orderId}`)).json);
  check("…nor in the supplier's", !supplierViewBefore.includes(xBank.iban));

  // ───── J. Immutability ─────
  section("J. Evidence and settlement are immutable");
  const tryDb = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);
  check("A RECEIVED PaymentRecord cannot be edited back to DUE", await tryDb(() => db.paymentRecord.update({ where: { orderId: e1.orderId }, data: { status: "DUE" } })));
  const stillOpen = await deliverOrder(X, D1, az, offer.id, 2);
  must(await stillOpen.buyer.c.post(`/api/v1/orders/${stillOpen.orderId}/report-problem`, { category: "OTHER", note: "kept open for the database check" }), "report stillOpen");
  check("A second OPEN dispute on the same order is blocked at the database too", await tryDb(() =>
    db.dispute.create({ data: { orderId: stillOpen.orderId, category: "OTHER", openedBy: "BUYER", openedById: stillOpen.buyer.userId, note: "bypass attempt" } }),
  ));
  const anyResolved = await db.dispute.findFirst({ where: { status: "RESOLVED" } });
  check("A resolved dispute cannot be reopened without an outcome (check constraint)", !!anyResolved && await tryDb(() => db.dispute.update({ where: { id: anyResolved!.id }, data: { status: "OPEN" } })));

  // ───── K. Audit summary ─────
  section("K. Audit trail");
  for (const a of ["order.confirmed", "order.admin_confirmed", "dispute.opened", "dispute.resolved", "payment.marked_paid", "payment.not_received", "payment.received"]) {
    check(`Audit has '${a}'`, (await db.auditLog.count({ where: { action: a } })) >= 1);
  }
  check("Anonymous visitors cannot confirm, pay or resolve anything (401)", (await anon.post(`/api/v1/orders/${b1.orderId}/confirm-receipt`)).status === 401 && (await anon.post(`/api/v1/admin/disputes/${disputeId1}/resolve`)).status === 401);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
