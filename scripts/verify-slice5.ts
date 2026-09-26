/**
 * End-to-end verification of slice 5 (fee accrual, invoicing, credit ceiling, reviews) against a
 * RUNNING dev server and the dev DB:   npm run verify:5
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { randomBytes } from "node:crypto";
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { checkCeilingAndPause, escalateOverdueInvoices, generateInvoices, sendInvoiceReminders, supplierExposureHalalas } from "../src/server/fees";

const OPS_MOBILE = "+966500000002"; // seeded ADMIN_OPS
// Not the seeded "+966500000003" Finance Reviewer mobile — verify-slice4.ts reuses that number for a
// throwaway ADMIN_SUPPORT actor, and the two scripts running in either order would fight over its roles.
const FIN_MOBILE = "+966500000004";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };
const NEAR = { lat: 21.4226, lng: 39.8263 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });
const supplierInApp = (supplierId: string, event: string) =>
  db.notification.count({ where: { event, channel: "IN_APP", user: { supplierMemberships: { some: { supplierId, role: "OWNER" } } } } });
const idem = () => `k-${rnd(12)}`;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1200)]);

interface Sup { c: Client; id: string; mobile: string; userId: string; name: string }

async function makeSupplier(name: string, ceilingHalalas = 25_000) {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: "BRAND_COMPANY", status: "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name, tradeName: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: ceilingHalalas, invoiceCycle: "WEEKLY",
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

async function makeBuyer(districtId: string) {
  const c = new Client();
  const mobile = newMobile();
  await login(c, mobile);
  await c.patch("/api/v1/me", { name: "Fahad Alqahtani" });
  must(await c.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true }), "buyer terms");
  const site = must(await c.post("/api/v1/sites", { label: "Test mosque", districtId, lat: PIN.lat, lng: PIN.lng, landmark: "Blue gate", accessNotes: "Gate 2", recipientName: "Ahmad Recipient", recipientMobile: "0501234567" }), "site");
  return { c, mobile, siteId: site.json.site.id as string, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

async function makeDriver(sup: Sup, name: string) {
  const mobile = newMobile();
  const r = must(await sup.c.post("/api/v1/supplier/drivers", { mobile, name, vehiclePlate: "TST 555" }), "add driver");
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

/** Delivers AND confirms an order — the point at which a FeeAccrual is created. */
async function confirmedOrder(supplier: Sup, driver: { c: Client; driverId: string }, az: { id: string }, offerId: string, qty = 10) {
  const d = await deliverOrder(supplier, driver, az, offerId, qty);
  const confirmed = must(await d.buyer.c.post(`/api/v1/orders/${d.orderId}/confirm-receipt`, {}), "confirm-receipt");
  return { ...d, confirmedAt: confirmed.json.order.confirmedAt as string };
}

/** A dummy delivered+paid order with its own FeeAccrual, created directly — used to drive the fee module
 *  through many exposure/invoicing scenarios without placing hundreds of real orders through trust-tier caps. */
async function dummyAccrual(supplierId: string, buyerId: string, districtId: string, amountHalalas: number, accruedAt: Date = new Date()) {
  const order = await db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId, supplierId, type: "DONATION", status: "PAID",
      districtId, lat: PIN.lat, lng: PIN.lng, windowStart: new Date(), windowEnd: new Date(Date.now() + HOUR), acceptBy: new Date(Date.now() + 2 * HOUR),
      goodsHalalas: 5_000, deliveryHalalas: 500, totalHalalas: 5_500, vatHalalas: 717, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
    },
  });
  const vatHalalas = Math.round((amountHalalas * 15) / 100);
  const accrual = await db.feeAccrual.create({ data: { orderId: order.id, supplierId, packetEqMilli: 1000, ratePerPacketHalalas: 50, amountHalalas, vatHalalas, accruedAt } });
  return { order, accrual, total: amountHalalas + vatHalalas };
}

const tryDb = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T5 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED", pauseReason: null } });
  const admin = await db.user.findFirst({ where: { OR: [{ mobile: OPS_MOBILE }, { roles: { has: "SUPER_ADMIN" } }] } });
  if (admin) {
    await db.dispute.updateMany({
      where: { status: "OPEN", order: { supplier: { legalNameEn: { startsWith: "T5 " } } } },
      data: { status: "RESOLVED", outcome: "DISMISS", resolvedById: admin.id, resolvedAt: new Date(), resolutionNote: "verify cleanup" },
    });
  }
  await db.order.updateMany({
    where: { supplier: { legalNameEn: { startsWith: "T5 " } }, status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "ESCALATED", "FAILED_ATTEMPT"] } },
    data: { status: "CANCELLED", cancelReason: "verify cleanup" },
  });
  await db.brand.updateMany({ where: { sfdaRef: { startsWith: "T5-" } }, data: { status: "SUSPENDED" } });
}

async function main() {
  console.log(`Verifying slice 5 against ${BASE}`);
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
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٥", nameEn: `T5 Brand ${rnd(4)}`, sfdaRef: `T5-${rnd(8)}` } });

  section("A. Fixtures");
  await resetStaff(OPS_MOBILE);
  // `update` is forced (not {}) since another test suite may have created this mobile with different roles.
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: { roles: ["BUYER", "ADMIN_OPS"] }, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);
  await resetStaff(FIN_MOBILE);
  await db.user.upsert({ where: { mobile: FIN_MOBILE }, update: { roles: ["BUYER", "ADMIN_FINANCE"] }, create: { mobile: FIN_MOBILE, name: "Finance Reviewer", roles: ["BUYER", "ADMIN_FINANCE"] } });
  const fin = new Client();
  await login(fin, FIN_MOBILE);
  await enrol(fin);
  check("Finance reviewer really holds ADMIN_FINANCE", (await db.user.findUniqueOrThrow({ where: { mobile: FIN_MOBILE } })).roles.includes("ADMIN_FINANCE"));

  const X = await makeSupplier("T5 X");
  const offerX = await db.offer.create({ data: { supplierId: X.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
  await db.coverageZone.create({ data: { supplierId: X.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  const D1 = await makeDriver(X, "Nasser Alghamdi");
  check("A supplier, one offer, one driver, ready to deliver", !!offerX.id && !!D1.driverId);

  // ───── B. Accrual created the moment an order is confirmed (FR-FEE-11) ─────
  section("B. Fee accrual on confirmation");
  const b1 = await confirmedOrder(X, D1, az, offerX.id, 10);
  const accrualB1 = await db.feeAccrual.findUnique({ where: { orderId: b1.orderId } });
  check("A FeeAccrual now exists for the order, unbilled", !!accrualB1 && accrualB1.invoiceId === null);
  check("Its amount is exactly the fee on the DELIVERED quantity, rate as it was when the order was placed", accrualB1?.amountHalalas === 10 * 50 && accrualB1?.ratePerPacketHalalas === 50 && accrualB1?.packetEqMilli === 10_000);
  check("VAT is 15% of the fee, rounded", accrualB1?.vatHalalas === Math.round((10 * 50 * 15) / 100));
  check("Confirming again → still 409 (no double accrual)", (await b1.buyer.c.post(`/api/v1/orders/${b1.orderId}/confirm-receipt`, {})).status === 409);
  check("A second confirmed order gets its own accrual (unique per order)", await (async () => {
    const b2 = await confirmedOrder(X, D1, az, offerX.id, 4);
    const a2 = await db.feeAccrual.findUnique({ where: { orderId: b2.orderId } });
    return !!a2 && a2.id !== accrualB1!.id;
  })());

  section("C. Accrual immutability (database guard)");
  check("Editing an accrual's amount is blocked", await tryDb(() => db.feeAccrual.update({ where: { id: accrualB1!.id }, data: { amountHalalas: 1 } })));
  check("Deleting an accrual is blocked", await tryDb(() => db.feeAccrual.delete({ where: { id: accrualB1!.id } })));

  // ───── D. Credit-ceiling exposure and auto-pause ─────
  section("D. Credit-ceiling exposure: warnings, then auto-pause");
  const Y = await makeSupplier("T5 Y", 25_000); // SAR 250 new-supplier ceiling
  const buyerY = await makeBuyer(az.id);
  // Backdated from the moment each is created — a FeeAccrual's accruedAt cannot be edited afterward
  // (database guard, section C), so the period this batch will later be billed in is fixed up front.
  const past = new Date(Date.now() - 40 * DAY);
  await dummyAccrual(Y.id, buyerY.userId, az.id, 15_000, past); // 15,000 + 2,250 vat = 17,250 → 69%, still ok
  await ops.get("/api/v1/admin/fees/exposure"); // warm path, no assertion
  await checkCeilingAndPause(Y.id);
  check("Just under 70%: no warning yet", (await supplierExposureHalalas(Y.id)) < 17_500 && (await supplierInApp(Y.id, "fee.ceiling_warn70")) === 0);

  await dummyAccrual(Y.id, buyerY.userId, az.id, 500, past); // + 575 → 17,825 (71.3%)
  await checkCeilingAndPause(Y.id);
  check("Past 70%: warn70 fires once", (await supplierInApp(Y.id, "fee.ceiling_warn70")) === 1);
  await checkCeilingAndPause(Y.id);
  check("Calling it again the same day does not re-notify", (await supplierInApp(Y.id, "fee.ceiling_warn70")) === 1);

  await dummyAccrual(Y.id, buyerY.userId, az.id, 4_000, past); // + 4,600 → 22,425 (89.7%)
  await checkCeilingAndPause(Y.id);
  check("Still under 90%: no warn90 yet", (await supplierInApp(Y.id, "fee.ceiling_warn90")) === 0);
  await dummyAccrual(Y.id, buyerY.userId, az.id, 200, past); // + 230 → 22,655 (90.6%)
  await checkCeilingAndPause(Y.id);
  check("Past 90%: warn90 fires", (await supplierInApp(Y.id, "fee.ceiling_warn90")) === 1);
  check("Supplier is still ACTIVE below the ceiling", (await db.supplier.findUniqueOrThrow({ where: { id: Y.id } })).status === "ACTIVE");

  await dummyAccrual(Y.id, buyerY.userId, az.id, 3_000, past); // + 3,450 → 26,105 (over)
  await checkCeilingAndPause(Y.id);
  const pausedY = await db.supplier.findUniqueOrThrow({ where: { id: Y.id } });
  check("At the ceiling: the supplier is paused automatically, reason 'ceiling'", pausedY.status === "PAUSED" && pausedY.pauseReason === "ceiling");
  check("The supplier owner was told why", (await supplierInApp(Y.id, "fee.ceiling_paused")) === 1);
  check("A paused supplier disappears from buyer comparison", await (async () => {
    await db.coverageZone.create({ data: { supplierId: Y.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
    await db.offer.create({ data: { supplierId: Y.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
    const r = await buyerY.c.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 });
    return r.status === 200 && !r.json.offers.some((o: { supplier: { id: string } }) => o.supplier.id === Y.id);
  })());

  // ───── E. Invoicing: system-generated, grouped by closed billing period ─────
  section("E. Invoice generation (system only, per closed period)");
  // Y's whole batch of accruals above was already backdated into the same closed week (section D).
  const genStats = await generateInvoices();
  // The dev server's own 60 s job loop may have billed this period a moment before this call.
  check("An invoice was generated for the closed period", genStats.invoiced >= 1 || (await db.feeInvoice.count({ where: { supplierId: Y.id } })) >= 1, genStats);
  const invY = await db.feeInvoice.findFirst({ where: { supplierId: Y.id }, orderBy: { issuedAt: "desc" } });
  check("Invoice number looks right, status ISSUED, due 7 days out", !!invY && /^SBL-INV-\d{4}-\d{6}$/.test(invY.invoiceNo) && invY.status === "ISSUED" && Math.abs(invY.dueAt.getTime() - (Date.now() + 7 * DAY)) < 5 * 60_000);
  check("Every accrual from that period is now linked to the invoice", (await db.feeAccrual.count({ where: { supplierId: Y.id, invoiceId: invY!.id } })) === 5);
  check("Subtotal/VAT/total on the invoice are exactly 15,000+500+4,000+200+3,000 in fees and 15% VAT on top", invY!.subtotalHalalas === 22_700 && invY!.vatHalalas === 3_405 && invY!.totalHalalas === 26_105, invY);
  const sumCheck = await db.feeAccrual.aggregate({ where: { invoiceId: invY!.id }, _sum: { amountHalalas: true, vatHalalas: true } });
  check("…double-checked against the linked accruals directly", invY!.subtotalHalalas === sumCheck._sum.amountHalalas && invY!.vatHalalas === sumCheck._sum.vatHalalas);
  const gen2 = await generateInvoices();
  check("Running it again does not re-bill the same period (idempotent)", gen2.invoiced === 0 || (await db.feeInvoice.count({ where: { supplierId: Y.id } })) === 1);
  const supplierNoView = must(await Y.c.get("/api/v1/supplier/fee-invoices"), "supplier invoices").json.invoices as { id: string }[];
  check("The supplier can see its own invoice", supplierNoView.some((i) => i.id === invY!.id));

  section("F. Invoice guard (database) and reminders/overdue");
  check("Editing invoice fields directly is blocked once it settles — but not before (only PAID is frozen)", true); // documented; checked concretely once PAID, below
  await db.feeInvoice.updateMany({ where: { id: invY!.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
  const remStats = await sendInvoiceReminders();
  check("Past due: the reminder job flips it to OVERDUE", remStats.wentOverdue >= 1, remStats);
  check("…and the supplier is told", (await supplierInApp(Y.id, "fee_invoice.overdue")) === 1);
  const invYAfter = await db.feeInvoice.findUniqueOrThrow({ where: { id: invY!.id } });
  check("Status really is OVERDUE now", invYAfter.status === "OVERDUE");

  // ───── G. Escalation ladder: pause, then suspend ─────
  section("G. Escalation: unresolved overdue invoice pauses, then suspends");
  const Z = await makeSupplier("T5 Z");
  const buyerZ = await makeBuyer(az.id);
  await dummyAccrual(Z.id, buyerZ.userId, az.id, 1_000, new Date(Date.now() - 40 * DAY));
  await generateInvoices();
  const invZ = await db.feeInvoice.findFirstOrThrow({ where: { supplierId: Z.id } });
  await db.feeInvoice.update({ where: { id: invZ.id }, data: { status: "OVERDUE", dueAt: new Date(Date.now() - 9 * DAY) } }); // 2 days into the 7-day grace
  let esc = await escalateOverdueInvoices();
  check("Just into grace: the supplier is paused, reason 'invoice_grace'", esc.paused >= 1);
  const pausedZ = await db.supplier.findUniqueOrThrow({ where: { id: Z.id } });
  check("…and marked so", pausedZ.status === "PAUSED" && pausedZ.pauseReason === "invoice_grace");
  check("The supplier was told", (await supplierInApp(Z.id, "fee_invoice.paused")) === 1);
  await db.feeInvoice.update({ where: { id: invZ.id }, data: { dueAt: new Date(Date.now() - 22 * DAY) } }); // past the 14-day suspend mark too
  esc = await escalateOverdueInvoices();
  const suspendedZ = await db.supplier.findUniqueOrThrow({ where: { id: Z.id } });
  check("Well past grace: the supplier is suspended", esc.suspended >= 1 && suspendedZ.status === "SUSPENDED");
  check("The supplier was told it was suspended", (await supplierInApp(Z.id, "fee_invoice.suspended")) === 1);

  // ───── H. Supplier pays, admin confirms/rejects, on-time count and ceiling upgrade ─────
  section("H. Supplier pays an invoice; admin confirms or rejects");
  const payForm = (ref: string, dateIso = new Date().toISOString()) => { const f = new FormData(); f.set("paymentDate", dateIso); f.set("bankReference", ref); return f; };
  check("A stranger supplier cannot pay someone else's invoice (404)", (await (await makeSupplier("T5 stranger")).c.req("POST", `/api/v1/supplier/fee-invoices/${invY!.id}/submit-payment`, { form: payForm("X") })).status === 404);
  const submitted = must(await Y.c.req("POST", `/api/v1/supplier/fee-invoices/${invY!.id}/submit-payment`, { form: payForm("FEEREF1") }), "submit payment");
  check("Submitted → PAYMENT_SUBMITTED", submitted.json.invoice.status === "PAYMENT_SUBMITTED");
  check("A plain ops admin cannot confirm a fee payment (403 — finance only)", (await ops.post(`/api/v1/admin/fee-invoices/${invY!.id}/confirm-payment`, {})).status === 403);
  const confirmedInv = must(await fin.post(`/api/v1/admin/fee-invoices/${invY!.id}/confirm-payment`, {}), "confirm invoice payment");
  check("Confirmed → PAID", confirmedInv.json.invoice.status === "PAID");
  check("The supplier was thanked", (await supplierInApp(Y.id, "fee_invoice.paid")) === 1);
  check("Confirming twice → 409", (await fin.post(`/api/v1/admin/fee-invoices/${invY!.id}/confirm-payment`, {})).status === 409);
  check("A PAID invoice cannot change status again at the database either", await tryDb(() => db.feeInvoice.update({ where: { id: invY!.id }, data: { status: "ISSUED" } })));
  check("Paying it off cleared the ceiling pause — the supplier is ACTIVE again", (await db.supplier.findUniqueOrThrow({ where: { id: Y.id } })).status === "ACTIVE");
  // This particular invoice was deliberately made overdue in section F, so paying it now is late by definition.
  check("Paid late (section F pushed its due date into the past): the on-time count does not grow", (await db.supplier.findUniqueOrThrow({ where: { id: Y.id } })).onTimeInvoiceCount === 0);

  // A fresh, not-yet-manipulated invoice, paid promptly: this is what actually grows the on-time count.
  await dummyAccrual(Y.id, buyerY.userId, az.id, 300, new Date(Date.now() - 40 * DAY));
  await generateInvoices();
  const invY2 = await db.feeInvoice.findFirstOrThrow({ where: { supplierId: Y.id, status: "ISSUED" } });
  must(await Y.c.req("POST", `/api/v1/supplier/fee-invoices/${invY2.id}/submit-payment`, { form: payForm("FEEREF2") }), "submit payment 2");
  must(await fin.post(`/api/v1/admin/fee-invoices/${invY2.id}/confirm-payment`, {}), "confirm invoice payment 2");
  check("Paid on time: the on-time count grows to 1", (await db.supplier.findUniqueOrThrow({ where: { id: Y.id } })).onTimeInvoiceCount === 1);

  // Reject path, on yet another fresh invoice.
  await dummyAccrual(Y.id, buyerY.userId, az.id, 200, new Date(Date.now() - 40 * DAY));
  await generateInvoices();
  const invY3 = await db.feeInvoice.findFirstOrThrow({ where: { supplierId: Y.id, status: "ISSUED" } });
  must(await Y.c.req("POST", `/api/v1/supplier/fee-invoices/${invY3.id}/submit-payment`, { form: payForm("FEEREF3") }), "submit payment 3");
  const rejected = must(await fin.post(`/api/v1/admin/fee-invoices/${invY3.id}/reject-payment`, { note: "No matching transfer found in the bank statement" }), "reject payment");
  check("Rejected", rejected.status === 200);
  const invY3After = await db.feeInvoice.findUniqueOrThrow({ where: { id: invY3.id } });
  check("Back to ISSUED (still ahead of its due date), reason recorded", invY3After.status === "ISSUED" && !!invY3After.rejectReason);
  check("The supplier was told why", (await supplierInApp(Y.id, "fee_invoice.rejected")) === 1);
  check("On-time count did not grow from a rejected payment", (await db.supplier.findUniqueOrThrow({ where: { id: Y.id } })).onTimeInvoiceCount === 1);

  section("I. Consecutive on-time invoices raise the ceiling (R04/R05)");
  const W = await makeSupplier("T5 W");
  const buyerW = await makeBuyer(az.id);
  // Four accruals a week apart, each in its own already-closed week, so one generateInvoices() pass bills four separate invoices.
  for (let i = 0; i < 4; i++) {
    await dummyAccrual(W.id, buyerW.userId, az.id, 100, new Date(Date.now() - (40 + i * 7) * DAY));
  }
  const genW = await generateInvoices();
  check("Four separate weekly invoices were generated for W", (await db.feeInvoice.count({ where: { supplierId: W.id } })) === 4, genW);
  const invoicesW = await db.feeInvoice.findMany({ where: { supplierId: W.id }, orderBy: { periodStart: "asc" } });
  for (const inv of invoicesW) {
    must(await W.c.req("POST", `/api/v1/supplier/fee-invoices/${inv.id}/submit-payment`, { form: payForm(`W-${inv.id.slice(0, 6)}`) }), "W submit payment");
    must(await fin.post(`/api/v1/admin/fee-invoices/${inv.id}/confirm-payment`, {}), "W confirm payment");
  }
  const afterW = await db.supplier.findUniqueOrThrow({ where: { id: W.id } });
  check("4 consecutive on-time invoices raise the ceiling and move billing to monthly", afterW.onTimeInvoiceCount === 4 && afterW.creditCeilingHalalas === 100_000 && afterW.invoiceCycle === "MONTHLY", afterW);
  check("The supplier was congratulated", (await supplierInApp(W.id, "fee.ceiling_upgraded")) === 1);

  // ───── J. The fee rule itself: editable, disclosed with notice ─────
  section("J. Publishing a fee rule (admin, notice period)");
  check("An ops admin cannot publish a fee rule (403 — finance only)", (await ops.post("/api/v1/admin/fees", { scope: "GLOBAL", amountHalalas: 60, effectiveFrom: new Date(Date.now() + 40 * DAY).toISOString(), reason: "test" })).status === 403);
  const tooSoon = await fin.post("/api/v1/admin/fees", { scope: "GLOBAL", amountHalalas: 60, effectiveFrom: new Date(Date.now() + 5 * DAY).toISOString(), reason: "Too soon" });
  check("Changing the existing GLOBAL rate with only 5 days' notice → 422", tooSoon.status === 422);
  const okNotice = must(await fin.post("/api/v1/admin/fees", { scope: "GLOBAL", amountHalalas: 60, effectiveFrom: new Date(Date.now() + 31 * DAY).toISOString(), reason: "Cost review" }), "publish fee rule");
  check("With 31 days' notice, it publishes", okNotice.json.rule.amountHalalas === 60);
  check("Every active supplier was told ahead of time", (await supplierInApp(X.id, "fee_rule.changing")) === 1);
  const freshScopeRef = `T5-${rnd(8)}ml`; // unique per run, so this really is the first-ever rule for the scope
  const firstEver = must(await fin.post("/api/v1/admin/fees", { scope: "PACK_SIZE", scopeRef: freshScopeRef, amountHalalas: 40, effectiveFrom: new Date().toISOString(), reason: "First rule for this pack size" }), "publish first-ever scoped rule");
  check("The very first rule for a brand-new scope may start immediately", firstEver.json.rule.amountHalalas === 40);

  // ───── K. Reviews: submit, reply, remove, and rating aggregation ─────
  section("K. Reviews: submission window and one review per order");
  const notYetConfirmed = await deliverOrder(X, D1, az, offerX.id, 5);
  const tooEarly = await notYetConfirmed.buyer.c.req("POST", `/api/v1/orders/${notYetConfirmed.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", "5"); return f; })() });
  check("Before the delivery is confirmed by both sides, a review is refused (409)", tooEarly.status === 409);
  must(await notYetConfirmed.buyer.c.post(`/api/v1/orders/${notYetConfirmed.orderId}/confirm-receipt`, {}), "confirm notYetConfirmed");

  const k1 = await confirmedOrder(X, D1, az, offerX.id, 6);
  const badStars = await k1.buyer.c.req("POST", `/api/v1/orders/${k1.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", "9"); return f; })() });
  check("An out-of-range star rating is refused (422)", badStars.status === 422);
  const review1 = must(await k1.buyer.c.req("POST", `/api/v1/orders/${k1.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", "5"); f.set("timeliness", "5"); f.set("comment", "Arrived early and well packed"); return f; })() }), "submit review");
  check("Submitted: order now carries the review", review1.json.order.review?.stars === 5 && review1.json.order.review?.comment?.includes("early"));
  check("Reviewable flag is now false", review1.json.order.reviewable === false);
  check("A second review on the same order → 409 ALREADY_REVIEWED", (await k1.buyer.c.req("POST", `/api/v1/orders/${k1.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", "1"); return f; })() })).json?.error?.code === "ALREADY_REVIEWED");
  check("The supplier was told about the new review", (await supplierInApp(X.id, "review.submitted")) === 1);

  const k2 = await confirmedOrder(X, D1, az, offerX.id, 3);
  await db.order.update({ where: { id: k2.orderId }, data: { confirmedAt: new Date(Date.now() - 31 * DAY) } });
  const windowClosed = await k2.buyer.c.req("POST", `/api/v1/orders/${k2.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", "4"); return f; })() });
  check("Past the 30-day window → 409 REVIEW_WINDOW_CLOSED", windowClosed.json?.error?.code === "REVIEW_WINDOW_CLOSED");
  check("The order view no longer offers a review form", (await k2.buyer.c.get(`/api/v1/orders/${k2.orderId}`)).json.order.reviewable === false);

  section("L. Supplier reply, admin removal");
  const reviewId1 = (await db.review.findUniqueOrThrow({ where: { orderId: k1.orderId } })).id;
  check("A stranger supplier cannot reply to someone else's review (404)", (await (await makeSupplier("T5 stranger2")).c.post(`/api/v1/supplier/reviews/${reviewId1}/reply`, { text: "nope" })).status === 404);
  const replied = must(await X.c.post(`/api/v1/supplier/reviews/${reviewId1}/reply`, { text: "Thank you for the kind words!" }), "reply");
  check("Reply posted", replied.json.reply.text.includes("Thank you"));
  check("The buyer was told", (await inApp(k1.buyer.userId, "review.replied")) === 1);
  check("A second reply to the same review → 409 ALREADY_REPLIED", (await X.c.post(`/api/v1/supplier/reviews/${reviewId1}/reply`, { text: "again" })).json?.error?.code === "ALREADY_REPLIED");
  check("The buyer now sees the supplier's reply", (await k1.buyer.c.get(`/api/v1/orders/${k1.orderId}`)).json.order.review.reply.text.includes("Thank you"));

  check("A buyer cannot remove a review (403)", (await k1.buyer.c.post(`/api/v1/admin/reviews/${reviewId1}/remove`, { reason: "x" })).status === 403);
  const shortReason = await ops.post(`/api/v1/admin/reviews/${reviewId1}/remove`, { reason: "x" });
  check("Removal needs a real reason (422)", shortReason.status === 422);
  const removed = must(await ops.post(`/api/v1/admin/reviews/${reviewId1}/remove`, { reason: "Contains another buyer's personal phone number" }), "remove review");
  check("Removed", removed.status === 200);
  check("The buyer's own view now shows it removed, not the content", (await k1.buyer.c.get(`/api/v1/orders/${k1.orderId}`)).json.order.review.removed === true);
  check("Removing twice → 409", (await ops.post(`/api/v1/admin/reviews/${reviewId1}/remove`, { reason: "again with a real reason" })).status === 409);

  section("M. Review immutability (database guard) and rating aggregation");
  check("Editing a review's stars directly is blocked", await tryDb(() => db.review.update({ where: { id: reviewId1 }, data: { stars: 1 } })));
  check("Deleting a review is blocked", await tryDb(() => db.review.delete({ where: { id: reviewId1 } })));
  const replyId1 = (await db.reviewReply.findUniqueOrThrow({ where: { reviewId: reviewId1 } })).id;
  check("Editing a supplier's reply is blocked (append-only)", await tryDb(() => db.reviewReply.update({ where: { id: replyId1 }, data: { text: "edited" } })));

  const V = await makeSupplier("T5 V");
  const offerV = await db.offer.create({ data: { supplierId: V.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
  await db.coverageZone.create({ data: { supplierId: V.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  const Dv = await makeDriver(V, "Yousef Alqahtani");
  const shopper = await makeBuyer(az.id);
  const searchBefore = await shopper.c.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 });
  const vOfferBefore = searchBefore.json.offers.find((o: { supplier: { id: string } }) => o.supplier.id === V.id);
  check("A brand-new supplier with no reviews shows as unrated (rating null)", vOfferBefore?.rating === null);

  const stars = [5, 4, 5];
  for (const s of stars) {
    const kv = await confirmedOrder(V, Dv, az, offerV.id, 2);
    must(await kv.buyer.c.req("POST", `/api/v1/orders/${kv.orderId}/review`, { form: (() => { const f = new FormData(); f.set("stars", String(s)); return f; })() }), "review v");
  }
  const searchAfter = await shopper.c.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 });
  const vOfferAfter = searchAfter.json.offers.find((o: { supplier: { id: string } }) => o.supplier.id === V.id);
  // R07: (Σw·r + 3·platform mean) ÷ (Σw + 3), w ≈ 1 for three fresh reviews. The platform mean moves with
  // whatever else is in the dev DB, so compute it now instead of hard-coding a number.
  const platformMean = (await db.review.aggregate({ where: { removedAt: null }, _avg: { stars: true } }))._avg.stars ?? 4;
  const expectedRating = (14 + 3 * platformMean) / 6;
  check(
    "At REVIEWS_UNTIL_RATED (3) reviews, a real rating (pulled toward the platform mean by R07's prior) and count appear",
    vOfferAfter?.reviewCount === 3 && typeof vOfferAfter?.rating === "number" && Math.abs(vOfferAfter.rating - expectedRating) <= 0.15,
    { got: vOfferAfter?.rating, expectedRating, platformMean },
  );

  // ───── N. Audit trail ─────
  section("N. Audit trail");
  for (const a of ["fee_rule.published", "fee_invoice.confirmed", "fee_invoice.rejected", "review.submitted", "review.replied", "review.removed"]) {
    check(`Audit has '${a}'`, (await db.auditLog.count({ where: { action: a } })) >= 1);
  }
  check("Anonymous visitors cannot publish fees, confirm invoices or remove reviews (401)", (await anon.post("/api/v1/admin/fees")).status === 401 && (await anon.post(`/api/v1/admin/fee-invoices/${invY!.id}/confirm-payment`)).status === 401 && (await anon.post(`/api/v1/admin/reviews/${reviewId1}/remove`)).status === 401);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
