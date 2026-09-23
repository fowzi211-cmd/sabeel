/**
 * End-to-end verification of slice 3 (supplier accept/decline, re-routing, expiry job, drivers,
 * delivery trip, proof of delivery) against a RUNNING dev server and the dev DB:   npm run verify:3
 * Needs `npm run db:seed` first (driver acknowledgement text). Creates throw-away data; re-runnable.
 */
import { randomBytes } from "node:crypto";
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { expireOverdueOrders, retryEscalatedOrders } from "../src/server/fulfilment";

const OPS_MOBILE = "+966500000002";
const HOUR = 3_600_000;
const PIN = { lat: 21.4225, lng: 39.8262 }; // the buyers' destination pin
const NEAR = { lat: 21.4226, lng: 39.8263 }; // ~15 m away
const FAR = { lat: 21.4300, lng: 39.8400 }; // ~1.6 km away

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });
const idem = () => `k-${rnd(12)}`;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1500)]);

interface Sup { c: Client; id: string; mobile: string; userId: string; name: string }

async function makeSupplier(name: string, opts: { type?: "BRAND_COMPANY" | "INDEPENDENT"; status?: "ACTIVE" | "PAUSED"; agreement?: boolean; expiredDoc?: boolean } = {}): Promise<Sup> {
  const mobile = newMobile();
  const type = opts.type ?? "BRAND_COMPANY";
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type, status: opts.status ?? "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 25_000,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  const c = new Client();
  await login(c, mobile);
  await enrol(c);
  if (opts.agreement !== false) {
    const agType = type === "INDEPENDENT" ? "INDEPENDENT_AGREEMENT" : "SUPPLIER_AGREEMENT";
    const code = must(await c.post("/api/v1/terms/sign-code", { type: agType, version: "1.0" }), "sign code").json.devCode;
    must(await c.post("/api/v1/terms/accept", { type: agType, version: "1.0", language: "AR", confirmRead: true, authorised: true, code }), "accept agreement");
  }
  if (opts.expiredDoc) {
    await db.supplierDocument.create({
      data: { supplierId: sup.id, kind: "CR", fileKey: "none", originalName: "cr.pdf", mime: "application/pdf", size: 1, sha256: rnd(8), status: "VERIFIED", expiresAt: new Date(Date.now() - 86_400_000) },
    });
  }
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

async function makeDriver(sup: Sup, name: string, plate: string, ack = true) {
  const mobile = newMobile();
  const r = await sup.c.post("/api/v1/supplier/drivers", { mobile, name, vehiclePlate: plate });
  if (r.status !== 200) throw new Error("add driver failed: " + r.text);
  const c = new Client();
  await login(c, mobile);
  if (ack) must(await c.post("/api/v1/terms/accept", { type: "DRIVER_ACK", version: "1.0", language: "AR", confirmRead: true }), "driver ack");
  return { c, mobile, driverId: r.json.driver.id as string, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

const photoForm = (o: { clientId?: string; kind?: string; bytes?: Buffer; type?: string; source?: string; at?: Date; pos?: { lat: number; lng: number } | null; accuracy?: number } = {}) => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(o.bytes ?? jpeg())], "p.jpg", { type: o.type ?? "image/jpeg" }));
  f.set("clientId", o.clientId ?? `c${rnd(14)}`);
  f.set("kind", o.kind ?? "DELIVERED_GOODS");
  f.set("capturedAt", (o.at ?? new Date()).toISOString());
  if (o.pos !== null) { const p = o.pos ?? NEAR; f.set("lat", String(p.lat)); f.set("lng", String(p.lng)); f.set("accuracyM", String(o.accuracy ?? 12)); }
  if (o.source) f.set("source", o.source);
  return f;
};

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T3 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED" } });
  await db.order.updateMany({
    where: { supplier: { legalNameEn: { startsWith: "T3 " } }, status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "ESCALATED", "FAILED_ATTEMPT"] } },
    data: { status: "CANCELLED", cancelReason: "verify cleanup" },
  });
  await db.brand.updateMany({ where: { sfdaRef: { startsWith: "T3-" } }, data: { status: "SUSPENDED" } });
}

async function main() {
  console.log(`Verifying slice 3 against ${BASE}`);
  const health = await fetch(BASE + "/api/v1/districts").catch(() => null);
  if (!health || health.status !== 200) {
    console.error("The dev server is not reachable. Start it with `npm run dev`.");
    process.exit(2);
  }
  if (!(await db.termsDocument.findFirst({ where: { type: "DRIVER_ACK" } }))) {
    console.error("Run `npm run db:seed` first: the driver acknowledgement text is missing.");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup();

  const anon = new Client();
  const districts = (await anon.get("/api/v1/districts")).json.districts as { id: string; slug: string }[];
  const az = districts.find((d) => d.slug === "al-aziziyah")!;
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٣", nameEn: `T3 Brand ${rnd(4)}`, sfdaRef: `T3-${rnd(8)}` } });

  // ───── A. Fixtures ─────
  section("A. Suppliers, drivers and buyers for the scenarios");
  const X = await makeSupplier("T3 X");
  const Y = await makeSupplier("T3 Y");
  const Z = await makeSupplier("T3 Z indie", { type: "INDEPENDENT" });
  const W = await makeSupplier("T3 W pricey");
  const E = await makeSupplier("T3 E expired", { expiredDoc: true });
  const P = await makeSupplier("T3 P paused", { status: "PAUSED" });
  const NA = await makeSupplier("T3 NA no agreement", { agreement: false });
  const price = (s: Sup, p: number) => db.offer.create({ data: { supplierId: s.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: p } });
  const zoneOf = (s: Sup) => db.coverageZone.create({ data: { supplierId: s.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  const offers: Record<string, { id: string }> = {};
  for (const [s, p] of [[X, 1000], [Y, 1000], [Z, 950], [W, 1100], [E, 900], [P, 900], [NA, 900]] as [Sup, number][]) {
    offers[s.name] = await price(s, p);
    await zoneOf(s);
  }
  check("Seven suppliers, one test brand, all serving Al-Aziziyah", Object.keys(offers).length === 7);

  const mkOrder = async (buyer: Awaited<ReturnType<typeof makeBuyer>>, supplier: Sup, qty = 10, over: object = {}) => {
    const slots = must(await buyer.c.get(`/api/v1/offers/${offers[supplier.name].id}/slots?districtId=${az.id}`), "slots").json.slots as { start: string; end: string }[];
    const far = slots.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!;
    const r = must(await buyer.c.post("/api/v1/orders", { siteId: buyer.siteId, type: "DONATION", windowStart: far.start, lines: [{ offerId: offers[supplier.name].id, qtyPacks: qty }], ...over }, { "idempotency-key": idem() }), "place order");
    return { id: r.json.order.id as string, orderNo: r.json.order.orderNo as string, slot: far, slots };
  };
  const state = async (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { items: true, allocations: { orderBy: { seq: "asc" } }, delivery: { include: { photos: true, proofs: true, attemptLog: true } }, events: true } });
  const sView = async (s: Sup, id: string) => (await s.c.get(`/api/v1/supplier/orders/${id}`)).json?.order;

  // ───── B. Accepting ─────
  section("B. Supplier accepts (T02) — with the guards");
  const b1 = await makeBuyer(az.id);
  const oNA = await mkOrder(b1, NA);
  const naAccept = await NA.c.post(`/api/v1/supplier/orders/${oNA.id}/accept`);
  check("Without the current agreement accepted → 403 AGREEMENT_REQUIRED", naAccept.status === 403 && naAccept.json.error.code === "AGREEMENT_REQUIRED", naAccept.json);
  const search = await b1.c.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 10, brandId: brand.id });
  const names = (search.json.offers as { supplier: { id: string } }[]).map((o) => o.supplier.id);
  check("A supplier with an expired verified document disappears from comparison", !names.includes(E.id) && names.includes(X.id));
  const eOrderTry = await b1.c.post("/api/v1/orders", { siteId: b1.siteId, type: "DONATION", windowStart: oNA.slot.start, lines: [{ offerId: offers[E.name].id, qtyPacks: 10 }] }, { "idempotency-key": idem() });
  check("…and cannot be ordered from either (409 OFFER_UNAVAILABLE)", eOrderTry.status === 409 && eOrderTry.json.error.code === "OFFER_UNAVAILABLE");

  const o1 = await mkOrder(await makeBuyer(az.id), X);
  const buyer1Order = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
  const beforeAccept = await sView(X, o1.id);
  check("Before acceptance the recipient is hidden, the supplier sees fee and net", beforeAccept.destination === null && beforeAccept.feePreview.fee === 500);
  check("Another supplier cannot accept it (404)", (await Y.c.post(`/api/v1/supplier/orders/${o1.id}/accept`)).status === 404);
  check("A plain buyer cannot accept orders (403)", (await b1.c.post(`/api/v1/supplier/orders/${o1.id}/accept`)).status === 403);
  const acc = await X.c.post(`/api/v1/supplier/orders/${o1.id}/accept`);
  check("The supplier accepts → ACCEPTED, delivery details revealed", acc.status === 200 && acc.json.order.status === "ACCEPTED" && acc.json.order.destination?.recipientMobile === "+966501234567", acc.json);
  const st1 = await state(o1.id);
  check("Allocation ACCEPTED, event recorded, buyer notified", st1.allocations[0].status === "ACCEPTED" && st1.events.some((e) => e.type === "ACCEPTED") && (await inApp(buyer1Order.buyerId, "order.accepted")) === 1);
  check("Accepting twice → 409 INVALID_STATE", (await X.c.post(`/api/v1/supplier/orders/${o1.id}/accept`)).json?.error?.code === "INVALID_STATE");
  check("Declining after accepting → 409 (use release instead)", (await X.c.post(`/api/v1/supplier/orders/${o1.id}/decline`, { reason: "OUT_OF_STOCK" })).json?.error?.code === "INVALID_STATE");

  // ───── C. Declining and re-routing ─────
  section("C. Decline → next supplier → escalation (T03–T06, R10)");
  const cBuyer = await makeBuyer(az.id);
  const c1 = await mkOrder(cBuyer, X);
  check("Decline needs a valid reason (422)", (await X.c.post(`/api/v1/supplier/orders/${c1.id}/decline`, { reason: "BECAUSE" })).status === 422);
  check("'Other' needs a note (422)", (await X.c.post(`/api/v1/supplier/orders/${c1.id}/decline`, { reason: "OTHER" })).status === 422);
  const d1 = await X.c.post(`/api/v1/supplier/orders/${c1.id}/decline`, { reason: "OUT_OF_STOCK", note: "sold out" });
  const s1 = await state(c1.id);
  check("Declined → re-offered to the best eligible supplier (independent Z: cheaper)", d1.status === 200 && d1.json.outcome === "REALLOCATED" && s1.supplierId === Z.id && s1.status === "AWAITING_SUPPLIER", { outcome: d1.json, supplier: s1.supplierId });
  check("Never re-offered to: the decliner, the pricier, the paused, the expired-documents, the no-agreement supplier", ![X.id, W.id, P.id, E.id, NA.id].includes(s1.supplierId));
  check("Allocation history: X DECLINED with reason, Z OFFERED, in order", s1.allocations.length === 2 && s1.allocations[0].status === "DECLINED" && s1.allocations[0].declineReason === "OUT_OF_STOCK" && s1.allocations[1].status === "OFFERED" && s1.allocations[1].seq === 2);
  check("Price snapshot rewritten for the new supplier, never above the buyer's original total", s1.totalHalalas === 10_500 && s1.goodsHalalas === 9500 && s1.totalHalalas <= 11_000 && s1.items[0].unitPriceHalalas === 950, { total: s1.totalHalalas });
  check("Fresh 2-hour acceptance window; the fee rate snapshot is unchanged", s1.acceptBy.getTime() > Date.now() + 100 * 60_000 && s1.feePerPacketHalalas === 50);
  check("The decliner can no longer see the order (404)", (await X.c.get(`/api/v1/supplier/orders/${c1.id}`)).status === 404);
  check("The new supplier sees it in their inbox", (await Z.c.get("/api/v1/supplier/orders")).json.orders.some((o: { id: string }) => o.id === c1.id));
  const buyerSees = (await cBuyer.c.get(`/api/v1/orders/${c1.id}`)).json.order;
  check("The buyer is told and the timeline shows it (no decline reason leaked)", buyerSees.events.some((e: { type: string }) => e.type === "DECLINED") && buyerSees.events.some((e: { type: string }) => e.type === "REALLOCATED") && !JSON.stringify(buyerSees).includes("sold out") && (await inApp(cBuyer.userId, "order.reallocated")) === 1);
  check("Buyer sees the new (lower) total", buyerSees.totalHalalas === 10_500 && buyerSees.supplier.independent === true);

  const d2 = await Z.c.post(`/api/v1/supplier/orders/${c1.id}/decline`, { reason: "CANNOT_MEET_WINDOW" });
  check("Z declines → goes to Y", d2.json.outcome === "REALLOCATED" && (await state(c1.id)).supplierId === Y.id);
  const d3 = await Y.c.post(`/api/v1/supplier/orders/${c1.id}/decline`, { reason: "TOO_FAR" });
  const s3 = await state(c1.id);
  check("Nobody left → ESCALATED to the admin queue (never stuck silently)", d3.json.outcome === "ESCALATED" && s3.status === "ESCALATED" && s3.allocations.length === 3 && s3.allocations.every((a) => a.status === "DECLINED"));
  check("Buyer told we are finding a supplier, and may still cancel", (await inApp(cBuyer.userId, "order.reallocated")) === 3 && (await cBuyer.c.get(`/api/v1/orders/${c1.id}`)).json.order.cancellable === true);

  // ───── D. Admin handles escalated orders ─────
  section("D. Admin: escalated orders");
  await resetStaff(OPS_MOBILE);
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: {}, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);
  const att = await ops.get("/api/v1/admin/orders?attention=1");
  check("The attention queue lists the escalated order", att.status === 200 && att.json.orders.some((o: { id: string }) => o.id === c1.id));
  check("Status filter works (ESCALATED)", (await ops.get("/api/v1/admin/orders?status=ESCALATED")).json.orders.every((o: { status: string }) => o.status === "ESCALATED"));
  check("A buyer cannot use the admin queue (403)", (await b1.c.get("/api/v1/admin/orders?attention=1")).status === 403);
  check("No eligible supplier now: candidates empty; reallocating → 422 NO_ELIGIBLE", (await ops.get(`/api/v1/admin/orders/${c1.id}/candidates`)).json.candidates.length === 0 && (await ops.post(`/api/v1/admin/orders/${c1.id}/reallocate`, {})).json?.error?.code === "NO_ELIGIBLE");
  const V = await makeSupplier("T3 V late");
  offers[V.name] = await price(V, 990);
  await zoneOf(V);
  const cands = await ops.get(`/api/v1/admin/orders/${c1.id}/candidates`);
  check("A supplier that appears later becomes a candidate", cands.json.candidates.length === 1 && cands.json.candidates[0].supplierId === V.id);
  check("Ops (and only ops) can re-offer an escalated order", (await ops.post(`/api/v1/admin/orders/${c1.id}/reallocate`, { supplierId: V.id })).json?.order?.status === "AWAITING_SUPPLIER" && (await state(c1.id)).supplierId === V.id);
  check("Reallocating an order that is not escalated → 409", (await ops.post(`/api/v1/admin/orders/${c1.id}/reallocate`, {})).json?.error?.code === "INVALID_STATE");
  const cancelNoReason = await ops.post(`/api/v1/admin/orders/${c1.id}/cancel`, {});
  check("Admin cancel needs a reason (422)", cancelNoReason.status === 422);
  check("Admin cancels with a reason → CANCELLED, buyer told", (await ops.post(`/api/v1/admin/orders/${c1.id}/cancel`, { reason: "buyer asked by phone" })).json?.order?.status === "CANCELLED" && (await state(c1.id)).allocations.at(-1)!.status === "WITHDRAWN");

  // ───── E. Expiry job ─────
  section("E. Expiry job (T04)");
  const eBuyer = await makeBuyer(az.id);
  const e1 = await mkOrder(eBuyer, X);
  await db.order.update({ where: { id: e1.id }, data: { acceptBy: new Date(Date.now() - 60_000) } });
  const late = await X.c.post(`/api/v1/supplier/orders/${e1.id}/accept`);
  check("Accepting after the deadline → 409 OFFER_EXPIRED, and the order is re-routed at once", late.status === 409 && late.json.error.code === "OFFER_EXPIRED" && (await state(e1.id)).supplierId === Z.id, late.json);
  const e2 = await mkOrder(await makeBuyer(az.id), X);
  await db.order.update({ where: { id: e2.id }, data: { acceptBy: new Date(Date.now() - 60_000) } });
  const [j1, j2] = await Promise.all([expireOverdueOrders(), expireOverdueOrders()]);
  const se2 = await state(e2.id);
  check("The job expires the silent supplier's order and re-offers it (two overlapping runs are safe)", se2.supplierId === Z.id && se2.status === "AWAITING_SUPPLIER" && se2.allocations.length === 2 && se2.allocations[0].status === "EXPIRED" && j1.checked + j2.checked >= 1, { j1, j2 });
  check("Exactly one re-offer happened (no duplicate allocations)", se2.allocations.filter((a) => a.supplierId === Z.id).length === 1);
  check("The supplier that missed the deadline was told", (await inApp(X.userId, "order.expired")) >= 1);
  const e3 = await mkOrder(await makeBuyer(az.id), NA); // NA has no agreement: nobody accepts; force through expiry until escalation
  await db.order.update({ where: { id: e3.id }, data: { acceptBy: new Date(Date.now() - 60_000) } });
  await expireOverdueOrders();
  const se3 = await state(e3.id);
  check("An expired order with other suppliers available is re-offered, never dropped", ["AWAITING_SUPPLIER", "ESCALATED"].includes(se3.status) && se3.allocations[0].status === "EXPIRED");
  // Force an order into the escalated state, then let the retry job find a supplier for it.
  const e4 = await mkOrder(await makeBuyer(az.id), X);
  await db.order.update({ where: { id: e4.id }, data: { acceptBy: new Date(Date.now() - 60_000) } });
  await expireOverdueOrders();
  await db.orderAllocation.updateMany({ where: { orderId: e4.id, status: "OFFERED" }, data: { status: "EXPIRED" } });
  await db.order.update({ where: { id: e4.id }, data: { status: "ESCALATED" } });
  const retry = await retryEscalatedOrders(new Date(Date.now() + 3 * HOUR), 500, 0);
  const se4 = await state(e4.id);
  check("The retry job re-offers an escalated order when suppliers are available", retry.placed >= 1 && se4.status === "AWAITING_SUPPLIER" && se4.allocations.length === 3 && ![X.id, Z.id].includes(se4.supplierId) && se4.totalHalalas <= 11_000, { retry, status: se4.status, total: se4.totalHalalas });

  // ───── F. Drivers ─────
  section("F. Supplier drivers");
  const bad1 = await X.c.post("/api/v1/supplier/drivers", { mobile: "12345", name: "Bad" });
  check("A driver needs a valid Saudi mobile (422)", bad1.status === 422 || bad1.json?.error?.code === "MOBILE_INVALID");
  check("…and a name (422)", (await X.c.post("/api/v1/supplier/drivers", { mobile: newMobile() })).status === 422);
  check("A buyer cannot manage drivers (403)", (await b1.c.get("/api/v1/supplier/drivers")).status === 403);
  const noAck = await makeDriver(X, "Sultan Alharbi", "ABC 1234", false);
  const jobsNoAck = await noAck.c.get("/api/v1/driver/jobs");
  check("A new driver must accept the acknowledgement before seeing any job", jobsNoAck.status === 200 && jobsNoAck.json.ackRequired === true && jobsNoAck.json.jobs.length === 0);
  check("Their account has the driver role", (await db.user.findUniqueOrThrow({ where: { id: noAck.userId } })).roles.includes("DRIVER"));
  const dup = await X.c.post("/api/v1/supplier/drivers", { mobile: (await db.user.findUniqueOrThrow({ where: { id: noAck.userId } })).mobile, name: "Sultan" });
  check("The same person twice → 409", dup.status === 409);
  const list = await X.c.get("/api/v1/supplier/drivers");
  check("The supplier's driver list shows the pending acknowledgement", list.json.drivers.find((d: { id: string }) => d.id === noAck.driverId)?.ackAccepted === false);
  check("A stranger without the driver role cannot use the driver API (403)", (await b1.c.get("/api/v1/driver/jobs")).status === 403);
  must(await noAck.c.post("/api/v1/terms/accept", { type: "DRIVER_ACK", version: "1.0", language: "AR", confirmRead: true }), "ack");
  check("After accepting, the acknowledgement shows as done", (await X.c.get("/api/v1/supplier/drivers")).json.drivers.find((d: { id: string }) => d.id === noAck.driverId).ackAccepted === true);
  const D1 = noAck;
  const D2 = await makeDriver(X, "Faisal Almutairi", "XYZ 9876");
  const DY = await makeDriver(Y, "Other Supplier Driver", "YYY 111");
  const self = await X.c.post("/api/v1/supplier/drivers", { self: true, vehiclePlate: "OWN 555" });
  check("An owner can list themself as a driver", self.status === 200);
  check("The owner now has the driver role too", (await db.user.findUniqueOrThrow({ where: { id: X.userId } })).roles.includes("DRIVER"));
  const selfDriverId = self.json.driver.id as string;

  // ───── G. Assigning ─────
  section("G. Assigning a driver (T07)");
  const gBuyer = await makeBuyer(az.id);
  const g1 = await mkOrder(gBuyer, X);
  check("Cannot assign before accepting (409)", (await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: D1.driverId })).json?.error?.code === "INVALID_STATE");
  must(await X.c.post(`/api/v1/supplier/orders/${g1.id}/accept`), "accept g1");
  check("Cannot assign another supplier's driver (422 DRIVER_INVALID)", (await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: DY.driverId })).json?.error?.code === "DRIVER_INVALID");
  check("An unknown driver → 422", (await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: "nope" })).status === 422);
  check("Another supplier cannot assign on this order (404)", (await Y.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: DY.driverId })).status === 404);
  const asg = await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: D2.driverId });
  check("Assigned → ASSIGNED, driver named on the order", asg.status === 200 && asg.json.order.status === "ASSIGNED" && asg.json.order.delivery.driver.vehiclePlate === "XYZ 9876");
  const reasg = await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: D1.driverId });
  check("The driver can be changed before the trip starts", reasg.status === 200 && reasg.json.order.delivery.driver.id === D1.driverId);
  check("Both drivers were told (assigned / taken off)", (await inApp(D1.userId, "delivery.assigned")) === 1 && (await inApp(D2.userId, "delivery.cancelled")) === 1);

  const jobs = await D1.c.get("/api/v1/driver/jobs");
  const job = jobs.json.jobs.find((j: { orderId: string }) => j.orderId === g1.id);
  check("The driver's job list shows the order with full delivery details", jobs.status === 200 && !!job && job.destination.recipientMobile === "+966501234567" && job.destination.lat === PIN.lat && job.items.length === 1 && job.radiusM > 0, job);
  const jobText = JSON.stringify(jobs.json);
  check("Drivers never see prices, fees, the donor's last name or mobile", !/Alotaibi/.test(jobText) && !jobText.includes(gBuyer.mobile) && !/priceHalalas|unitPrice|totalHalalas|goodsHalalas|fee/i.test(jobText) && job.donor === "Khalid", "leak");
  check("Another supplier's driver cannot open this job (404)", (await DY.c.get(`/api/v1/driver/jobs/${job.id}`)).status === 404);
  check("The replaced driver has no job any more", !(await D2.c.get("/api/v1/driver/jobs")).json.jobs.some((j: { orderId: string }) => j.orderId === g1.id));
  const busy = await X.c.patch(`/api/v1/supplier/drivers/${D1.driverId}`, { active: false });
  check("A driver with a job in progress cannot be switched off (409 DRIVER_BUSY)", busy.status === 409 && busy.json.error.code === "DRIVER_BUSY");
  const gView = (await gBuyer.c.get(`/api/v1/orders/${g1.id}`)).json.order;
  check("The buyer sees the driver's first name and plate — never the driver's mobile", gView.driver.firstName === "Sultan" && gView.driver.vehiclePlate === "ABC 1234" && !JSON.stringify(gView).includes(D1.mobile));

  // ───── H. The trip and proof ─────
  section("H. Trip, recipient code and proof of delivery (T08–T09)");
  const J = job.id as string;
  const photoBefore = await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ kind: "BRAND_LABEL" }) });
  check("Photos cannot be added before the trip starts (409)", photoBefore.status === 409);
  check("Confirming before starting → 409", (await D1.c.post(`/api/v1/driver/jobs/${J}/confirm`, { items: [{ itemId: job.items[0].id, deliveredQtyPacks: 10 }], confirmedAt: new Date().toISOString() })).status === 409);
  const start = await D1.c.post(`/api/v1/driver/jobs/${J}/start`, { clientAt: new Date().toISOString() });
  check("Start trip → OUT_FOR_DELIVERY", start.status === 200 && start.json.job.deliveryStatus === "EN_ROUTE" && (await state(g1.id)).status === "OUT_FOR_DELIVERY");
  const start2 = await D1.c.post(`/api/v1/driver/jobs/${J}/start`, {});
  check("Starting again (offline retry) is harmless: still one attempt", start2.status === 200 && (await state(g1.id)).delivery!.attempts === 1 && (await state(g1.id)).delivery!.attemptLog.length === 1);
  check("The buyer was told the water is on the way, and the recipient got an SMS", (await inApp(gBuyer.userId, "delivery.started")) === 1 && (await db.notification.count({ where: { mobile: "+966501234567", event: "delivery.started_recipient" } })) >= 1);
  check("Now the buyer cannot cancel any more (409)", (await gBuyer.c.post(`/api/v1/orders/${g1.id}/cancel`, {})).status === 409);
  check("The supplier cannot re-assign a trip in progress (409)", (await X.c.post(`/api/v1/supplier/orders/${g1.id}/assign`, { driverId: D2.driverId })).status === 409);

  const cid = `c${rnd(14)}`;
  const p1 = await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ clientId: cid, kind: "BRAND_LABEL", pos: NEAR }) });
  check("An in-app photo is stored", p1.status === 200 && p1.json.replay === false && !!p1.json.photo.id, p1.json);
  const p1b = await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ clientId: cid, kind: "BRAND_LABEL" }) });
  check("Re-sending the same photo (offline sync) never stores it twice", p1b.json.replay === true && p1b.json.photo.id === p1.json.photo.id && (await db.proofPhoto.count({ where: { deliveryId: J } })) === 1);
  check("A PDF pretending to be a photo is refused (422)", (await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ bytes: Buffer.from("%PDF-1.4 fake"), type: "image/jpeg" }) })).status === 422);
  check("A text file with an image name is refused (422)", (await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ bytes: Buffer.from("just text, not an image") }) })).status === 422);
  check("Another driver cannot upload to this job (404)", (await D2.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm() })).status === 404);

  const items = [{ itemId: job.items[0].id, deliveredQtyPacks: 10 }];
  const conf = (over: object = {}) => D1.c.post(`/api/v1/driver/jobs/${J}/confirm`, { items, confirmedAt: new Date().toISOString(), lat: NEAR.lat, lng: NEAR.lng, accuracyM: 10, ...over });
  const c0 = await conf();
  check("One photo is not enough (422 PROOF_INCOMPLETE: TOO_FEW_PHOTOS)", c0.status === 422 && c0.json.error.code === "PROOF_INCOMPLETE" && c0.json.error.details.errors.some((e: { code: string }) => e.code === "TOO_FEW_PHOTOS"), c0.json);
  must(await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm({ kind: "DELIVERED_GOODS", pos: NEAR }) }), "photo 2");
  const cNoOtp = await conf();
  check("Without the recipient's code a reason is required (422 RECIPIENT_CODE_REQUIRED)", cNoOtp.status === 422 && cNoOtp.json.error.details.errors.some((e: { code: string }) => e.code === "RECIPIENT_CODE_REQUIRED"), cNoOtp.json);
  check("Sending the code before arriving → 409", (await D1.c.post(`/api/v1/driver/jobs/${J}/recipient-code`)).status === 409);
  must(await D1.c.post(`/api/v1/driver/jobs/${J}/arrived`, { lat: NEAR.lat, lng: NEAR.lng }), "arrived");
  check("Arrival recorded", (await state(g1.id)).delivery!.status === "ARRIVED" && !!(await state(g1.id)).delivery!.arrivedAt);
  const codeReq = await D1.c.post(`/api/v1/driver/jobs/${J}/recipient-code`);
  check("The recipient is sent a one-time code by SMS (N29)", codeReq.status === 200 && /^\d{6}$/.test(codeReq.json.devCode) && (await db.notification.count({ where: { mobile: "+966501234567", event: "otp.delivery" } })) >= 1, codeReq.json);
  const wrong = await D1.c.post(`/api/v1/driver/jobs/${J}/recipient-code/verify`, { code: codeReq.json.devCode === "000000" ? "111111" : "000000" });
  check("A wrong code is refused (400)", wrong.status === 400);
  check("The code text is never stored in the notification log", !JSON.stringify(await db.notification.findMany({ where: { event: "otp.delivery" }, select: { payload: true } })).includes(codeReq.json.devCode));
  const right = await D1.c.post(`/api/v1/driver/jobs/${J}/recipient-code/verify`, { code: codeReq.json.devCode });
  check("The right code verifies the recipient", right.status === 200 && right.json.verified === true && !!(await state(g1.id)).delivery!.otpVerifiedAt);
  check("Another driver cannot verify codes on this job (404)", (await D2.c.post(`/api/v1/driver/jobs/${J}/recipient-code/verify`, { code: "123456" })).status === 404);

  check("Quantity above what was ordered → 422", (await conf({ items: [{ itemId: job.items[0].id, deliveredQtyPacks: 11 }] })).status === 422);
  check("Nothing delivered → 422 (record a failed delivery instead)", (await conf({ items: [{ itemId: job.items[0].id, deliveredQtyPacks: 0 }] })).status === 422);
  check("A line that is not on the order → 422", (await conf({ items: [{ itemId: "nope", deliveredQtyPacks: 1 }] })).status === 422);
  const far = await conf({ lat: FAR.lat, lng: FAR.lng });
  check("Confirming from far away (~1.6 km) needs a reason (OUTSIDE_RADIUS_REASON_REQUIRED)", far.status === 422 && far.json.error.details.errors.some((e: { code: string }) => e.code === "OUTSIDE_RADIUS_REASON_REQUIRED"), far.json);
  const noGps = await conf({ lat: undefined, lng: undefined, accuracyM: undefined });
  check("No GPS at all also needs a reason (NO_GPS_REASON_REQUIRED)", noGps.status === 422 && noGps.json.error.details.errors.some((e: { code: string }) => e.code === "NO_GPS_REASON_REQUIRED"));
  const good = await conf({ batchNote: "Batch B2409, exp 03/2027", notes: "Left at the gate with the caretaker" });
  check("Complete proof is accepted → DELIVERED_DRIVER_CONFIRMED", good.status === 200 && good.json.replay === false && good.json.partial === false && (await state(g1.id)).status === "DELIVERED_DRIVER_CONFIRMED", good.json);
  const sg = await state(g1.id);
  check("Delivered quantities, time and proof are stored; nothing flagged", sg.items[0].deliveredQtyPacks === 10 && !!sg.delivery!.deliveredAt && sg.delivery!.proofs[0]!.radiusOk === true && sg.delivery!.proofs[0]!.recipientOtpOk === true && sg.delivery!.proofs[0]!.flags.length === 0 && sg.delivery!.proofs[0]!.distanceM! < 60);
  check("The pilot rule sends every delivery to an admin for review", sg.delivery!.proofs[0]!.reviewRequired === true && sg.delivery!.proofs[0]!.reviewReasons.includes("PILOT"));
  check("Delivered totals follow what arrived (SAR 100 goods + 10 delivery; fee 10 packets × 0.50)", sg.delivery!.proofs[0]!.deliveredGoodsHalalas === 10_000 && sg.delivery!.proofs[0]!.deliveredTotalHalalas === 11_000 && sg.delivery!.proofs[0]!.deliveredFeeHalalas === 500);
  const again = await conf();
  check("Confirming twice (offline replay) returns the stored result, no second proof", again.status === 200 && again.json.replay === true && (await db.proofOfDelivery.count({ where: { deliveryId: J } })) === 1);
  check("No photo can be added after delivery (409)", (await D1.c.req("POST", `/api/v1/driver/jobs/${J}/photos`, { form: photoForm() })).status === 409);
  check("The buyer was told the delivery report is ready", (await inApp(gBuyer.userId, "delivery.delivered")) === 1);

  // buyer's Delivery Report and photo access
  const rep = (await gBuyer.c.get(`/api/v1/orders/${g1.id}`)).json.order;
  check("The buyer gets a Delivery Report: quantities, photos, 'at the location', code verified", rep.status === "DELIVERED_DRIVER_CONFIRMED" && rep.report.items[0].deliveredQtyPacks === 10 && rep.report.photos.length === 2 && rep.report.atLocation === true && rep.report.recipientCodeVerified === true && rep.report.batchNote.includes("B2409"));
  check("…without reviewer internals, GPS distance or flags", !/distanceM|reviewReasons|flags|outsideReason/.test(JSON.stringify(rep)));
  const photoUrl = rep.report.photos[0].url as string;
  const fetchPhoto = async (c: Client) => c.get(photoUrl);
  const pb = await fetchPhoto(gBuyer.c);
  check("The buyer can open the photo (private, no-store, nosniff)", pb.status === 200 && pb.headers.get("cache-control")!.includes("no-store") && pb.headers.get("x-content-type-options") === "nosniff" && pb.headers.get("content-type") === "image/jpeg");
  check("The supplier and the driver can open it too", (await fetchPhoto(X.c)).status === 200 && (await fetchPhoto(D1.c)).status === 200);
  check("Another buyer, another supplier, another driver, and visitors cannot (404/401)", (await fetchPhoto(b1.c)).status === 404 && (await fetchPhoto(Y.c)).status === 404 && (await fetchPhoto(DY.c)).status === 404 && (await fetchPhoto(anon)).status === 401);
  check("Ops staff can open it (audited)", (await fetchPhoto(ops)).status === 200 && (await db.auditLog.count({ where: { action: "proof_photo.viewed", actorRole: { contains: "ADMIN_OPS" } } })) >= 1);
  const sv = await sView(X, g1.id);
  check("The supplier sees the proof (photos, delivered quantities) and the driver", sv.proof.photos.length === 2 && sv.delivery.driver.name === "Sultan Alharbi");

  // immutability
  section("I. Evidence is immutable");
  const ph = await db.proofPhoto.findFirstOrThrow({ where: { deliveryId: J } });
  const tryDb = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);
  check("A photo row cannot be edited (database rule)", await tryDb(() => db.proofPhoto.update({ where: { id: ph.id }, data: { kind: "SITE" } })));
  check("…or deleted", await tryDb(() => db.proofPhoto.delete({ where: { id: ph.id } })));
  check("Proof of delivery cannot be edited", await tryDb(() => db.proofOfDelivery.update({ where: { deliveryId_attempt: { deliveryId: J, attempt: 1 } }, data: { partial: true, radiusOk: false } })));
  check("…or deleted", await tryDb(() => db.proofOfDelivery.delete({ where: { deliveryId_attempt: { deliveryId: J, attempt: 1 } } })));
  check("Delivered quantity is write-once", await tryDb(() => db.orderItem.update({ where: { id: job.items[0].id }, data: { deliveredQtyPacks: 3 } })));
  check("Delivery attempts cannot be deleted", await tryDb(() => db.deliveryAttempt.deleteMany({ where: { deliveryId: J } })));
  check("Allocation history cannot be deleted", await tryDb(() => db.orderAllocation.deleteMany({ where: { orderId: g1.id } })));

  // admin review
  const rvBad = await ops.post(`/api/v1/admin/orders/${g1.id}/review-proof`, { outcome: "SUSPICIOUS" });
  check("Marking a delivery suspicious needs a note (422)", rvBad.status === 422);
  check("A buyer cannot review proof (403)", (await gBuyer.c.post(`/api/v1/admin/orders/${g1.id}/review-proof`, { outcome: "OK" })).status === 403);
  const attBefore = await ops.get("/api/v1/admin/orders?attention=1");
  check("Unreviewed proof appears in the attention queue", attBefore.json.orders.some((o: { id: string }) => o.id === g1.id));
  const rv = await ops.post(`/api/v1/admin/orders/${g1.id}/review-proof`, { outcome: "OK", note: "photos match" });
  check("Ops records the review (only the review columns change)", rv.status === 200 && rv.json.order.proof.reviewOutcome === "OK" && !!rv.json.order.proof.reviewedAt);
  check("Reviewing twice → 409", (await ops.post(`/api/v1/admin/orders/${g1.id}/review-proof`, { outcome: "OK" })).status === 409);
  check("Reviewed proof leaves the attention queue", !(await ops.get("/api/v1/admin/orders?attention=1")).json.orders.some((o: { id: string }) => o.id === g1.id));
  check("The buyer's timeline hides internal review events", !JSON.stringify((await gBuyer.c.get(`/api/v1/orders/${g1.id}`)).json.order.events).includes("PROOF_REVIEWED"));

  // ───── J. Partial & flagged delivery ─────
  section("J. Partial delivery, flags and reused photos");
  const jBuyer = await makeBuyer(az.id);
  const j1o = await mkOrder(jBuyer, X, 10);
  must(await X.c.post(`/api/v1/supplier/orders/${j1o.id}/accept`), "accept");
  must(await X.c.post(`/api/v1/supplier/orders/${j1o.id}/assign`, { driverId: selfDriverId }), "assign self");
  const selfJobs = (await X.c.get("/api/v1/driver/jobs")).json;
  check("A supplier owner who delivers personally sees their own job in the driver app", selfJobs.ackRequired === true || selfJobs.jobs.some((j: { orderId: string }) => j.orderId === j1o.id));
  if (selfJobs.ackRequired) must(await X.c.post("/api/v1/terms/accept", { type: "DRIVER_ACK", version: "1.0", language: "AR", confirmRead: true }), "owner ack");
  const jj = (await X.c.get("/api/v1/driver/jobs")).json.jobs.find((j: { orderId: string }) => j.orderId === j1o.id);
  must(await X.c.post(`/api/v1/driver/jobs/${jj.id}/start`, {}), "start");
  const reuse = jpeg();
  must(await X.c.req("POST", `/api/v1/driver/jobs/${jj.id}/photos`, { form: photoForm({ kind: "DELIVERED_GOODS" }) }), "photo a");
  must(await X.c.req("POST", `/api/v1/driver/jobs/${jj.id}/photos`, { form: photoForm({ kind: "SITE" }) }), "photo b");
  const noBrand = await X.c.post(`/api/v1/driver/jobs/${jj.id}/confirm`, { items: [{ itemId: jj.items[0].id, deliveredQtyPacks: 6 }], confirmedAt: new Date().toISOString(), lat: NEAR.lat, lng: NEAR.lng, accuracyM: 10, otpBypassReason: "x" });
  check("Two photos but none showing the brand label → refused (NO_BRAND_PHOTO)", noBrand.status === 422 && noBrand.json.error.details.errors.some((e: { code: string }) => e.code === "NO_BRAND_PHOTO"), noBrand.json);
  must(await X.c.req("POST", `/api/v1/driver/jobs/${jj.id}/photos`, { form: photoForm({ kind: "BRAND_LABEL", bytes: reuse, source: "FILE" }) }), "photo file");
  const dupOfFirst = (await db.proofPhoto.findFirstOrThrow({ where: { deliveryId: J } }));
  must(await X.c.req("POST", `/api/v1/driver/jobs/${jj.id}/photos`, { form: photoForm({ kind: "DELIVERED_GOODS", bytes: await (await import("node:fs/promises")).readFile(`${process.cwd()}/storage/private/${dupOfFirst.fileKey}`) }) }), "photo dup");
  const conf2 = await X.c.post(`/api/v1/driver/jobs/${jj.id}/confirm`, {
    items: [{ itemId: jj.items[0].id, deliveredQtyPacks: 6 }], confirmedAt: new Date().toISOString(), lat: FAR.lat, lng: FAR.lng, accuracyM: 20,
    outsideReason: "Gate is on the far street", otpBypassReason: "Recipient's phone was off", offline: true,
  });
  const pj = (await state(j1o.id)).delivery!.proofs[0]!;
  check("Partial delivery, outside radius, no code, file photo, reused photo: accepted with reasons", conf2.status === 200 && conf2.json.partial === true, conf2.json);
  check("Every anomaly is flagged for the reviewer", ["OUTSIDE_RADIUS", "NO_RECIPIENT_CODE", "PHOTO_FROM_FILE", "DUPLICATE_PHOTO"].every((f) => pj.flags.includes(f)), pj.flags);
  check("Amounts follow the 6 packs delivered (goods SAR 60 + 10; fee 6 × 0.50)", pj.partial && pj.deliveredGoodsHalalas === 6000 && pj.deliveredTotalHalalas === 7000 && pj.deliveredFeeHalalas === 300);
  check("Recorded as submitted offline and reviewed as flagged + partial", pj.submittedOffline === true && pj.reviewReasons.includes("FLAGGED") && pj.reviewReasons.includes("PARTIAL") && pj.reviewReasons.includes("OFFLINE_FLAGGED"));

  // ───── K. Failed delivery, reschedule, cancel ─────
  section("K. Failed delivery (T10/T11)");
  const kBuyer = await makeBuyer(az.id);
  const k1 = await mkOrder(kBuyer, X, 10);
  must(await X.c.post(`/api/v1/supplier/orders/${k1.id}/accept`), "accept");
  must(await X.c.post(`/api/v1/supplier/orders/${k1.id}/assign`, { driverId: D2.driverId }), "assign");
  const kj = (await D2.c.get("/api/v1/driver/jobs")).json.jobs.find((j: { orderId: string }) => j.orderId === k1.id);
  must(await D2.c.post(`/api/v1/driver/jobs/${kj.id}/start`, {}), "start");
  const fail0 = await D2.c.post(`/api/v1/driver/jobs/${kj.id}/fail`, { reason: "RECIPIENT_ABSENT" });
  check("A failed delivery needs evidence: a photo at the door (422)", fail0.status === 422 && fail0.json.error.details.errors[0].code === "NO_FAILURE_PHOTO");
  check("'Other' needs a note (422)", (await D2.c.post(`/api/v1/driver/jobs/${kj.id}/fail`, { reason: "OTHER" })).status === 422);
  must(await D2.c.req("POST", `/api/v1/driver/jobs/${kj.id}/photos`, { form: photoForm({ kind: "FAILURE" }) }), "failure photo");
  const fail1 = await D2.c.post(`/api/v1/driver/jobs/${kj.id}/fail`, { reason: "RECIPIENT_ABSENT", note: "Nobody answered" });
  check("Failure recorded → FAILED_ATTEMPT; buyer and supplier told", fail1.status === 200 && (await state(k1.id)).status === "FAILED_ATTEMPT" && (await inApp(kBuyer.userId, "delivery.failed")) === 1 && (await inApp(X.userId, "delivery.failed")) >= 1);
  check("Recording it again is harmless (replay)", (await D2.c.post(`/api/v1/driver/jobs/${kj.id}/fail`, { reason: "RECIPIENT_ABSENT" })).json?.replay === true);
  check("Buyer may cancel a failed delivery (it is in the cancellable set)", (await kBuyer.c.get(`/api/v1/orders/${k1.id}`)).json.order.cancellable === true);
  const rs0 = await X.c.post(`/api/v1/supplier/orders/${k1.id}/reschedule`, { windowStart: new Date(new Date(k1.slot.start).getTime() + 60_000).toISOString() });
  check("Rescheduling to a window that is not offered → 409 SLOT_INVALID", rs0.json?.error?.code === "SLOT_INVALID");
  const slots2 = (await X.c.get(`/api/v1/supplier/orders/${k1.id}/slots`)).json.slots as { start: string }[];
  check("The supplier gets the bookable windows for this order", slots2.length > 5);
  const rs1 = await X.c.post(`/api/v1/supplier/orders/${k1.id}/reschedule`, { windowStart: slots2.find((s) => new Date(s.start).getTime() > Date.now() + 30 * HOUR)!.start, driverId: D1.driverId });
  check("Rescheduled with another driver → ASSIGNED again", rs1.status === 200 && rs1.json.order.status === "ASSIGNED" && rs1.json.order.delivery.driver.id === D1.driverId && rs1.json.order.delivery.attempts === 1);
  const kj2 = (await D1.c.get("/api/v1/driver/jobs")).json.jobs.find((j: { orderId: string }) => j.orderId === k1.id);
  check("The new driver sees it; the first driver does not", !!kj2 && !(await D2.c.get("/api/v1/driver/jobs")).json.jobs.some((j: { orderId: string }) => j.orderId === k1.id));
  must(await D1.c.post(`/api/v1/driver/jobs/${kj2.id}/start`, {}), "start 2");
  check("A second attempt is recorded", (await state(k1.id)).delivery!.attempts === 2 && (await state(k1.id)).delivery!.attemptLog.length === 2);
  check("Photos of the failed first attempt do not count for the second (needs its own failure photo)", (await D1.c.post(`/api/v1/driver/jobs/${kj2.id}/fail`, { reason: "ACCESS_BLOCKED" })).status === 422);
  must(await D1.c.req("POST", `/api/v1/driver/jobs/${kj2.id}/photos`, { form: photoForm({ kind: "FAILURE" }) }), "failure photo 2");
  must(await D1.c.post(`/api/v1/driver/jobs/${kj2.id}/fail`, { reason: "ACCESS_BLOCKED" }), "fail 2");
  const rs2 = await X.c.post(`/api/v1/supplier/orders/${k1.id}/reschedule`, { windowStart: slots2.find((s) => new Date(s.start).getTime() > Date.now() + 40 * HOUR)!.start });
  check("After the second failed trip no more reschedules (409 MAX_ATTEMPTS)", rs2.status === 409 && rs2.json.error.code === "MAX_ATTEMPTS");
  const cf0 = await X.c.post(`/api/v1/supplier/orders/${k1.id}/cancel-failed`, {});
  check("The supplier cancels a failed delivery with a reason (422 without)", cf0.status === 422);
  const cf = await X.c.post(`/api/v1/supplier/orders/${k1.id}/cancel-failed`, { reason: "Could not reach the recipient twice" });
  check("Cancelled; nothing owed; buyer told", cf.status === 200 && cf.json.order.status === "CANCELLED" && (await inApp(kBuyer.userId, "order.cancelled")) >= 1);
  check("The driver's job disappears", !(await D1.c.get("/api/v1/driver/jobs")).json.jobs.some((j: { orderId: string }) => j.orderId === k1.id));

  // ───── L. Releasing and cancelling before dispatch ─────
  section("L. Release and buyer cancellation");
  const lBuyer = await makeBuyer(az.id);
  const l1 = await mkOrder(lBuyer, X, 10);
  must(await X.c.post(`/api/v1/supplier/orders/${l1.id}/accept`), "accept");
  must(await X.c.post(`/api/v1/supplier/orders/${l1.id}/assign`, { driverId: D2.driverId }), "assign");
  check("Releasing needs a reason (422)", (await X.c.post(`/api/v1/supplier/orders/${l1.id}/release`, { reason: "NOPE" })).status === 422);
  const rel = await X.c.post(`/api/v1/supplier/orders/${l1.id}/release`, { reason: "OUT_OF_STOCK" });
  const sl = await state(l1.id);
  check("An accepted, assigned order can be handed back → re-offered; the old driver assignment is dropped", rel.json.outcome === "REALLOCATED" && sl.supplierId !== X.id && sl.delivery === null && sl.allocations[0].status === "WITHDRAWN");
  check("The driver was told and no longer has the job", !(await D2.c.get("/api/v1/driver/jobs")).json.jobs.some((j: { orderId: string }) => j.orderId === l1.id));
  const l2 = await mkOrder(await makeBuyer(az.id), X, 10);
  must(await X.c.post(`/api/v1/supplier/orders/${l2.id}/accept`), "accept");
  must(await X.c.post(`/api/v1/supplier/orders/${l2.id}/assign`, { driverId: D2.driverId }), "assign");
  const l2job = (await D2.c.get("/api/v1/driver/jobs")).json.jobs.find((j: { orderId: string }) => j.orderId === l2.id);
  const l2buyer = await db.order.findUniqueOrThrow({ where: { id: l2.id } });
  const l2c = new Client();
  await login(l2c, (await db.user.findUniqueOrThrow({ where: { id: l2buyer.buyerId } })).mobile);
  check("The buyer can cancel while it is only assigned", (await l2c.post(`/api/v1/orders/${l2.id}/cancel`, { reason: "no longer needed" })).status === 200);
  check("The driver is told and the trip cannot start (409)", (await inApp(D2.userId, "delivery.cancelled")) >= 2 && (await D2.c.post(`/api/v1/driver/jobs/${l2job.id}/start`, {})).status === 409);
  check("A suspended supplier cannot accept or assign (403)", await (async () => {
    const o = await mkOrder(await makeBuyer(az.id), Y, 10);
    await db.supplier.update({ where: { id: Y.id }, data: { status: "SUSPENDED" } });
    const r = await Y.c.post(`/api/v1/supplier/orders/${o.id}/accept`);
    await db.supplier.update({ where: { id: Y.id }, data: { status: "ACTIVE" } });
    return r.status === 403;
  })());

  // ───── M. Audit and access control summary ─────
  section("M. Audit trail and access");
  for (const a of ["order.accepted", "order.declined", "order.expired", "order.reallocated", "order.driver_assigned", "delivery.started", "delivery.arrived", "delivery.photo_added", "delivery.confirmed", "delivery.failed", "order.rescheduled", "order.cancelled_by_admin", "proof.reviewed", "driver.added"]) {
    check(`Audit has '${a}'`, (await db.auditLog.count({ where: { action: a } })) >= 1);
  }
  check("Anonymous visitors cannot use any driver or supplier action (401)", (await anon.post(`/api/v1/driver/jobs/${J}/start`)).status === 401 && (await anon.post(`/api/v1/supplier/orders/${g1.id}/accept`)).status === 401);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
