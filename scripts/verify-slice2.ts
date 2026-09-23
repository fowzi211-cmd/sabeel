/**
 * End-to-end verification of slice 2 (catalogue, coverage zones, comparison, ordering) against a
 * RUNNING dev server and the dev DB:   npm run verify:2
 * It creates throw-away suppliers, brands, buyers and orders with random data, so it can be re-run.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";

const OPS_MOBILE = "+966500000002";
const HOUR = 3_600_000;

interface TestSupplier {
  c: Client;
  id: string;
  mobile: string;
}

async function makeSupplier(name: string, opts: { type?: "BRAND_COMPANY" | "INDEPENDENT"; status?: "ACTIVE" | "PAUSED" } = {}): Promise<TestSupplier> {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: opts.type ?? "BRAND_COMPANY", status: opts.status ?? "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name,
      crNumber: newCr() + rnd(0), contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 25_000,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  const c = new Client();
  await login(c, mobile);
  await enrol(c);
  return { c, id: sup.id, mobile };
}

async function makeBuyer(opts: { name?: string | null; terms?: boolean; recipient?: boolean; districtId: string; anonymousSite?: boolean } ) {
  const c = new Client();
  const mobile = newMobile();
  await login(c, mobile);
  const name = opts.name === undefined ? "Khalid Alotaibi" : opts.name;
  if (name) await c.patch("/api/v1/me", { name });
  if (opts.terms !== false && name) {
    const r = await c.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true });
    if (r.status !== 200) throw new Error("terms accept failed: " + r.text);
  }
  const site = await c.post("/api/v1/sites", {
    label: "Test mosque", districtId: opts.districtId, lat: 21.4225, lng: 39.8262, landmark: "Next to the blue gate", accessNotes: "Gate 2",
    ...(opts.recipient === false ? {} : { recipientName: "Ahmad Recipient", recipientMobile: "0501234567" }),
  });
  if (site.status !== 200) throw new Error("site create failed: " + site.text);
  return { c, mobile, siteId: site.json.site.id as string, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

const idem = () => `k-${rnd(12)}`;
/** Setup steps must succeed; otherwise fail with the exact response instead of a confusing TypeError later. */
function must(r: Res, label: string): Res {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
}
const RIYADH = 3 * HOUR;

/**
 * The dev DB is shared with manual testing, so this script removes its own footprint from what buyers
 * can see: throw-away suppliers are off-boarded, test brands frozen and test districts switched off.
 * (Orders, buyers and audit rows stay; they are harmless and audit rows are append-only.)
 */
async function cleanup() {
  // Orders in flight would otherwise be picked up by the background jobs (expiry, escalation) long after this run.
  await db.order.updateMany({
    where: { supplier: { legalNameEn: { startsWith: "Supplier " } }, status: { in: ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "ESCALATED", "FAILED_ATTEMPT"] } },
    data: { status: "CANCELLED", cancelReason: "verify cleanup" },
  });
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "Supplier " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED" } });
  await db.brand.updateMany({ where: { sfdaRef: { startsWith: "T2-" } }, data: { status: "SUSPENDED" } });
  const districts = await db.district.findMany({ where: { slug: { startsWith: "t2-" } }, select: { id: true } });
  await db.coverageZone.updateMany({ where: { districtId: { in: districts.map((d) => d.id) } }, data: { active: false } });
  await db.district.updateMany({ where: { slug: { startsWith: "t2-" } }, data: { active: false } });
}

async function main() {
  console.log(`Verifying slice 2 against ${BASE}`);
  const health = await fetch(BASE + "/api/v1/districts").catch(() => null);
  if (!health || health.status !== 200) {
    console.error("The dev server is not reachable. Start it with `npm run dev` (and `npm run db:seed:demo`).");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup(); // leftovers from an earlier or aborted run

  const anon = new Client();

  // ───── A. Public reference data ─────
  section("A. Districts and brands");
  const dRes = await anon.get("/api/v1/districts");
  const districts = dRes.json.districts as { id: string; slug: string; restricted: boolean; restrictedReason: string | null }[];
  const aziziyah = districts.find((d) => d.slug === "al-aziziyah")!;
  const awali = districts.find((d) => d.slug === "al-awali")!;
  const haram = districts.find((d) => d.slug === "haram-central")!;
  check("Makkah districts are listed", districts.length >= 12 && !!aziziyah && !!awali);
  check("Restricted areas are listed but flagged, with a reason", haram?.restricted === true && !!haram.restrictedReason);

  const brandA = await db.brand.create({ data: { nameAr: "علامة اختبار", nameEn: `T2 Brand ${rnd(4)}`, sfdaRef: `T2-${rnd(8)}` } });
  const brandS = await db.brand.create({ data: { nameAr: "علامة مجمدة", nameEn: `T2 Frozen ${rnd(4)}`, sfdaRef: `T2-${rnd(8)}` } });
  await db.brand.update({ where: { id: brandS.id }, data: { status: "SUSPENDED" } });
  const brandList = (await anon.get("/api/v1/brands")).json.brands as { id: string }[];
  check("Public brand list shows active brands only", brandList.some((b) => b.id === brandA.id) && !brandList.some((b) => b.id === brandS.id));

  // ───── B. Catalogue management ─────
  section("B. Catalogue and coverage (supplier side)");
  const X = await makeSupplier("Supplier X");
  const Y = await makeSupplier("Supplier Y");
  const Z = await makeSupplier("Supplier Z (independent)", { type: "INDEPENDENT" });
  const P = await makeSupplier("Supplier P (paused)", { status: "PAUSED" });
  const N = await makeSupplier("Supplier N (elsewhere)");
  const mine = new Set([X.id, Y.id, Z.id, P.id, N.id]);

  const stranger = await makeBuyer({ districtId: aziziyah.id });
  check("A plain buyer cannot use the supplier catalogue API (403)", (await stranger.c.get("/api/v1/supplier/offers")).status === 403);
  const pOffer = await P.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 500 });
  check("A paused supplier cannot add offers (403 SUPPLIER_NOT_ACTIVE)", pOffer.status === 403 && pOffer.json.error.code === "SUPPLIER_NOT_ACTIVE");

  const badBrand = await X.c.post("/api/v1/supplier/offers", { brandId: brandS.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 900 });
  check("A frozen registry brand cannot be listed (422 BRAND_NOT_ALLOWED)", badBrand.status === 422 && badBrand.json.error.code === "BRAND_NOT_ALLOWED");
  check("An unknown brand is refused (422)", (await X.c.post("/api/v1/supplier/offers", { brandId: "nope", bottleMl: 500, bottlesPerPack: 20, priceHalalas: 900 })).status === 422);
  check("Price must be positive (422)", (await X.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 0 })).status === 422);
  check("Absurd price refused (422)", (await X.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 99_999_999 })).status === 422);

  const xo1 = must(await X.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 900, minQtyPacks: 5 }), "create offer X1");
  check("Supplier adds an offer (20-bottle packet ⇒ 1000 packet-equivalents)", xo1.status === 200 && xo1.json.offer.packetEqMilli === 1000, xo1.json);
  const xo24 = await X.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 24, priceHalalas: 1050 });
  check("A 24-bottle carton counts as 1.2 packets (1200)", xo24.status === 200 && xo24.json.offer.packetEqMilli === 1200);
  check("The same brand + pack twice → 409", (await X.c.post("/api/v1/supplier/offers", { brandId: brandA.id, bottleMl: 500, bottlesPerPack: 20, priceHalalas: 950 })).status === 409);
  const list = await X.c.get("/api/v1/supplier/offers");
  check("Supplier sees own offers and the fee rate (50 halalas)", list.status === 200 && list.json.offers.length === 2 && list.json.feePerPacketHalalas === 50);
  check("Another supplier cannot edit it (404)", (await Y.c.patch(`/api/v1/supplier/offers/${xo1.json.offer.id}`, { priceHalalas: 1 + 50 })).status === 404);
  check("Editing price works", (await X.c.patch(`/api/v1/supplier/offers/${xo24.json.offer.id}`, { priceHalalas: 1100 })).status === 200);
  check("Deleting an offer works", (await X.c.del(`/api/v1/supplier/offers/${xo24.json.offer.id}`)).json?.ok === true);

  // more offers/zones straight into the DB (cheaper than API calls, and needed for exclusion cases)
  const mkOffer = (supplierId: string, over: Partial<{ brandId: string; bottleMl: number; price: number; min: number; stock: "IN_STOCK" | "LIMITED" | "OUT"; active: boolean }> = {}) =>
    db.offer.create({ data: { supplierId, brandId: over.brandId ?? brandA.id, bottleMl: over.bottleMl ?? 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: over.price ?? 900, minQtyPacks: over.min ?? 1, stock: over.stock ?? "IN_STOCK", active: over.active ?? true } });
  const zone = (supplierId: string, districtId: string, fee: number, lead: number, active = true) =>
    db.coverageZone.create({ data: { supplierId, districtId, deliveryFeeHalalas: fee, leadTimeHours: lead, active } });

  const yo = await mkOffer(Y.id, { price: 1000 });
  await mkOffer(Z.id, { price: 950 });
  await mkOffer(P.id, { price: 500 });
  await mkOffer(N.id, { price: 400 });
  await mkOffer(X.id, { bottleMl: 330, stock: "OUT" }); // out of stock
  await mkOffer(X.id, { bottleMl: 200, min: 100 }); // minimum quantity above the search
  await mkOffer(X.id, { bottleMl: 250, active: false }); // switched off
  await mkOffer(X.id, { bottleMl: 600, brandId: brandS.id }); // brand frozen

  const put = (s: TestSupplier, districtId: string, fee: number, lead: number, active = true) =>
    s.c.put("/api/v1/supplier/coverage", { districtId, deliveryFeeHalalas: fee, leadTimeHours: lead, active });
  check("A supplier cannot serve a restricted area (422 RESTRICTED_ZONE)", (await put(X, haram.id, 0, 24)).json?.error?.code === "RESTRICTED_ZONE");
  check("Negative delivery fee refused (422)", (await put(X, aziziyah.id, -5, 24)).status === 422);
  const xz = must(await put(X, aziziyah.id, 2000, 24), "set zone");
  check("Supplier sets a coverage zone (fee SAR 20, lead 24 h)", xz.status === 200 && xz.json.zone.deliveryFeeHalalas === 2000);
  await zone(Y.id, aziziyah.id, 1500, 24);
  await zone(Z.id, aziziyah.id, 1000, 48);
  await zone(P.id, aziziyah.id, 500, 24);
  await zone(N.id, awali.id, 500, 24);
  const cov = await X.c.get("/api/v1/supplier/coverage");
  const covAz = cov.json.districts.find((d: { slug: string }) => d.slug === "al-aziziyah");
  check("Coverage screen lists every district with this supplier's settings", cov.status === 200 && covAz.zone.deliveryFeeHalalas === 2000 && cov.json.districts.some((d: { restricted: boolean }) => d.restricted));
  check("A paused supplier cannot change coverage (403)", (await put(P, aziziyah.id, 100, 24)).status === 403);

  // ───── C. Destinations ─────
  section("C. Saved destinations");
  const b0 = await makeBuyer({ districtId: aziziyah.id });
  const site = (over: object) => ({ label: "S", districtId: aziziyah.id, lat: 21.42, lng: 39.83, ...over });
  check("A pin outside Makkah is refused (422)", (await b0.c.post("/api/v1/sites", site({ lat: 24.71, lng: 46.67 }))).status === 422);
  check("A restricted district cannot be a destination (422 RESTRICTED_ZONE)", (await b0.c.post("/api/v1/sites", site({ districtId: haram.id }))).json?.error?.code === "RESTRICTED_ZONE");
  check("Bad National Address short code refused (422)", (await b0.c.post("/api/v1/sites", site({ nationalAddress: "12AB" }))).status === 422);
  check("Bad recipient mobile refused (422 MOBILE_INVALID)", (await b0.c.post("/api/v1/sites", site({ recipientMobile: "0412345678" }))).json?.error?.code === "MOBILE_INVALID");
  const okSite = await b0.c.post("/api/v1/sites", site({ nationalAddress: "rrrd2929", recipientName: "Um Fahad", recipientMobile: "0551112233" }));
  check("A valid destination is saved (National Address upper-cased, mobile normalised)", okSite.status === 200 && okSite.json.site.nationalAddress === "RRRD2929" && okSite.json.site.recipientMobile === "+966551112233");
  check("Destinations are private: another buyer cannot delete it (404)", (await stranger.c.del(`/api/v1/sites/${okSite.json.site.id}`)).status === 404);
  check("The owner can delete it", (await b0.c.del(`/api/v1/sites/${okSite.json.site.id}`)).json?.ok === true);
  check("…and it disappears from their list", !(await b0.c.get("/api/v1/sites")).json.sites.some((s: { id: string }) => s.id === okSite.json.site.id));

  // ───── D. Comparison ─────
  section("D. Comparison and search");
  const search = async (over: object = {}) =>
    (await b0.c.post("/api/v1/offers/search", { districtId: aziziyah.id, qtyPacks: 40, brandId: brandA.id, ...over })) as Res;
  const r = await search();
  const found = (r.json.offers as { supplier: { id: string }; totalHalalas: number }[]).filter((o) => mine.has(o.supplier.id));
  check("Search returns exactly the eligible offers (X, Y, Z)", r.status === 200 && found.length === 3, found.map((f) => f.supplier.id));
  check("Excluded: paused supplier, other district, out-of-stock, min-qty, inactive, frozen brand", !found.some((f) => [P.id, N.id].includes(f.supplier.id)) && r.json.offers.length === 3);
  const X1 = found.find((f) => f.supplier.id === X.id) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  check("Totals: goods = price × qty, total = goods + delivery, VAT extracted from the total", X1.goodsHalalas === 36_000 && X1.totalHalalas === 38_000 && X1.vatHalalas === 4957, X1);
  check("The platform fee is never part of what the buyer sees", !r.text.includes("feePerPacket") && !r.text.toLowerCase().includes("commission"));
  check("Reviews are not there yet: suppliers show as New (rating null)", X1.rating === null && X1.reviewCount === 0);
  check("Independent distributors are labelled", (r.json.offers as { supplier: { id: string; independent: boolean } }[]).find((o) => o.supplier.id === Z.id)!.supplier.independent === true);
  check("Sort by price puts the cheapest total first", (await search({ sort: "price" })).json.offers.map((o: { supplier: { id: string } }) => o.supplier.id).join() === [X.id, Z.id, Y.id].join());
  check("Sort by fastest puts the shortest lead time first (ties by price)", (await search({ sort: "fastest" })).json.offers.map((o: { supplier: { id: string } }) => o.supplier.id).join() === [X.id, Y.id, Z.id].join());
  check("'Best' ranks the cheap + fast supplier first", r.json.offers[0].supplier.id === X.id);
  check("Filter: hide independent distributors", !(await search({ includeIndependent: false })).json.offers.some((o: { supplier: { id: string } }) => o.supplier.id === Z.id));
  check("Filter: bottle size with no matching offers → empty", (await search({ bottleMl: 1500 })).json.offers.length === 0);
  check("A quantity below the minimum hides that offer", (await search({ qtyPacks: 3 })).json.offers.some((o: { supplier: { id: string } }) => o.supplier.id === X.id) === false);
  check("Search in a restricted district → 422 RESTRICTED_ZONE", (await search({ districtId: haram.id })).json?.error?.code === "RESTRICTED_ZONE");
  check("Anonymous visitors cannot search (401)", (await anon.post("/api/v1/offers/search", { districtId: aziziyah.id, qtyPacks: 40 })).status === 401);
  check("Quantity above 500 refused (422)", (await search({ qtyPacks: 501 })).status === 422);

  // ───── E. Delivery windows ─────
  section("E. Delivery windows");
  const slotsRes = must(await b0.c.get(`/api/v1/offers/${xo1.json.offer.id}/slots?districtId=${aziziyah.id}`), "delivery slots");
  const slots = slotsRes.json.slots as { start: string; end: string }[];
  check("Bookable windows are returned", slotsRes.status === 200 && slots.length > 5);
  const riyadhParts = (iso: string) => {
    const l = new Date(new Date(iso).getTime() + RIYADH);
    return { h: l.getUTCHours(), m: l.getUTCMinutes(), dow: l.getUTCDay() };
  };
  check("None starts before now + the supplier's 24 h lead time", new Date(slots[0].start).getTime() >= Date.now() + 24 * HOUR - 60_000);
  check("All fall inside 08:00–22:00 Riyadh and last 3 hours", slots.every((s) => riyadhParts(s.start).h >= 8 && riyadhParts(s.end).h <= 22 && new Date(s.end).getTime() - new Date(s.start).getTime() === 3 * HOUR));
  check("No window overlaps Friday prayer (11:00–14:00)", slots.every((s) => { const p = riyadhParts(s.start); return !(p.dow === 5 && p.h * 60 + p.m < 14 * 60 && p.h * 60 + p.m + 180 > 11 * 60); }));
  check("A restricted district has no windows (422)", (await b0.c.get(`/api/v1/offers/${xo1.json.offer.id}/slots?districtId=${haram.id}`)).status === 422);
  check("A district the supplier does not serve → 422 NOT_SERVED", (await b0.c.get(`/api/v1/offers/${xo1.json.offer.id}/slots?districtId=${awali.id}`)).json?.error?.code === "NOT_SERVED");

  // ───── F. Placing orders ─────
  section("F. Placing orders");
  const line = (offerId: string, qty: number) => ({ offerId, qtyPacks: qty });
  const base = (siteId: string, over: object = {}) => ({ siteId, type: "DONATION", windowStart: slots[0].start, lines: [line(xo1.json.offer.id, 40)], ...over });
  const post = (b: { c: Client }, body: object, key = idem()) => b.c.post("/api/v1/orders", body, { "idempotency-key": key });

  const B1 = await makeBuyer({ districtId: aziziyah.id });
  const key1 = idem();
  const o1 = must(await post(B1, base(B1.siteId), key1), "place order 1");
  check("A donation order is placed (201, AWAITING_SUPPLIER)", o1.status === 201 && o1.json.order.status === "AWAITING_SUPPLIER" && /^SBL-\d{4}-\d{6}$/.test(o1.json.order.orderNo), o1.json);
  check("Money is right: goods SAR 360 + delivery SAR 20 = SAR 380, VAT SAR 49.57", o1.json.order.goodsHalalas === 36_000 && o1.json.order.deliveryHalalas === 2000 && o1.json.order.totalHalalas === 38_000 && o1.json.order.vatHalalas === 4957);
  const dbOrder = await db.order.findUniqueOrThrow({ where: { id: o1.json.order.id }, include: { items: true, events: true } });
  check("The platform fee rate (50 halalas) and packet-equivalents are snapshotted; the buyer never sees them", dbOrder.feePerPacketHalalas === 50 && dbOrder.packetEqMilliTotal === 40_000 && !JSON.stringify(o1.json).includes("feePerPacket"));
  check("A 'PLACED' event is recorded; the supplier has 2 h to accept", dbOrder.events[0].type === "PLACED" && Math.abs(dbOrder.acceptBy.getTime() - (Date.now() + 2 * HOUR)) < 60_000);
  check("Buyer first name is snapshotted for the supplier (never the full name)", dbOrder.buyerFirstName === "Khalid");
  const replay = await post(B1, base(B1.siteId), key1);
  check("Retrying with the same Idempotency-Key returns the same order (200, replay)", replay.status === 200 && replay.json.replay === true && replay.json.order.id === o1.json.order.id);
  check("…and did not create a second order", (await db.order.count({ where: { buyerId: B1.userId } })) === 1);
  check("The supplier was notified (in-app)", (await db.notification.count({ where: { event: "order.placed", channel: "IN_APP", payload: { path: ["orderNo"], equals: o1.json.order.orderNo } } })) >= 1);

  const over = await post(B1, base(B1.siteId));
  check("A second order that pushes the buyer past SAR 500 in flight → 422 ORDER_LIMIT", over.status === 422 && over.json.error.code === "ORDER_LIMIT" && over.json.error.details.capHalalas === 50_000 && over.json.error.details.exposureHalalas === 38_000, over.json);
  const big = await makeBuyer({ districtId: aziziyah.id });
  check("A single order above the tier-1 cap → 422 ORDER_LIMIT", (await post(big, base(big.siteId, { lines: [line(xo1.json.offer.id, 100)] }))).json?.error?.code === "ORDER_LIMIT");

  check("A slot that is not on offer → 409 SLOT_INVALID", (await post(big, base(big.siteId, { windowStart: new Date(new Date(slots[0].start).getTime() + 60_000).toISOString() }))).json?.error?.code === "SLOT_INVALID");
  // a Friday-noon instant, several days ahead
  const now = new Date();
  let fridayNoon = 0;
  for (let d = 2; d < 9 && !fridayNoon; d++) {
    const l = new Date(now.getTime() + RIYADH + d * 24 * HOUR);
    if (l.getUTCDay() === 5) fridayNoon = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 12, 0) - RIYADH;
  }
  check("Friday-prayer time cannot be booked (409 SLOT_INVALID)", fridayNoon > 0 && (await post(big, base(big.siteId, { windowStart: new Date(fridayNoon).toISOString(), lines: [line(xo1.json.offer.id, 5)] }))).json?.error?.code === "SLOT_INVALID");
  check("Below the offer's minimum quantity → 409 OFFER_UNAVAILABLE", (await post(big, base(big.siteId, { lines: [line(xo1.json.offer.id, 2)] }))).json?.error?.code === "OFFER_UNAVAILABLE");
  check("Products from two suppliers in one order → 422", (await post(big, base(big.siteId, { lines: [line(xo1.json.offer.id, 5), line(yo.id, 5)] }))).status === 422);
  check("Unknown offer → 409 OFFER_UNAVAILABLE", (await post(big, base(big.siteId, { lines: [line("nope", 5)] }))).json?.error?.code === "OFFER_UNAVAILABLE");
  check("A supplier that does not serve the destination → 422 NOT_SERVED", (await post(big, base(big.siteId, { lines: [line((await db.offer.findFirstOrThrow({ where: { supplierId: N.id } })).id, 5)] }))).json?.error?.code === "NOT_SERVED");
  check("Someone else's destination → 404", (await post(big, base(B1.siteId, { lines: [line(xo1.json.offer.id, 5)] }))).status === 404);

  const noRecipient = await makeBuyer({ districtId: aziziyah.id, recipient: false });
  check("A donation without an on-site recipient → 422", (await post(noRecipient, base(noRecipient.siteId, { lines: [line(xo1.json.offer.id, 5)] }))).status === 422);
  const self = await post(noRecipient, base(noRecipient.siteId, { type: "SELF_USE", lines: [line(xo1.json.offer.id, 5)] }));
  check("A self-use order needs no recipient: the buyer is the recipient", self.status === 201 && self.json.order.destination.recipientMobile === noRecipient.mobile && self.json.order.destination.recipientName === "Khalid Alotaibi", self.json);

  const noTerms = await makeBuyer({ districtId: aziziyah.id, terms: false });
  check("Without accepting the buyer terms → 403 TERMS_REQUIRED", (await post(noTerms, base(noTerms.siteId, { lines: [line(xo1.json.offer.id, 5)] }))).json?.error?.code === "TERMS_REQUIRED");
  const noName = await makeBuyer({ districtId: aziziyah.id, name: null });
  check("Without a name in the profile → 422 PROFILE_INCOMPLETE", (await post(noName, base(noName.siteId, { lines: [line(xo1.json.offer.id, 5)] }))).json?.error?.code === "PROFILE_INCOMPLETE");
  const restrictedBuyer = await makeBuyer({ districtId: aziziyah.id });
  await db.user.update({ where: { id: restrictedBuyer.userId }, data: { restrictedUntil: new Date(Date.now() + 86_400_000) } });
  check("A restricted account (e.g. overdue payment) cannot order → 403", (await post(restrictedBuyer, base(restrictedBuyer.siteId, { lines: [line(xo1.json.offer.id, 5)] }))).json?.error?.code === "ACCOUNT_RESTRICTED");

  // concurrency: six simultaneous SAR 200 orders against a SAR 500 limit
  const racer = await makeBuyer({ districtId: aziziyah.id });
  const results = await Promise.all(Array.from({ length: 6 }, () => post(racer, base(racer.siteId, { lines: [line(xo1.json.offer.id, 20)] }))));
  const won = results.filter((x) => x.status === 201).length;
  const lim = results.filter((x) => x.json?.error?.code === "ORDER_LIMIT").length;
  check("Race: 6 simultaneous SAR 200 orders vs a SAR 500 limit → exactly 2 succeed", won === 2 && lim === 4, { won, lim, statuses: results.map((x) => x.status) });
  const racerTotal = (await db.order.aggregate({ where: { buyerId: racer.userId }, _sum: { totalHalalas: true } }))._sum.totalHalalas ?? 0;
  check("…and the buyer's total in flight never exceeds the limit", racerTotal <= 50_000, racerTotal);

  // price snapshot
  const priceBuyer = await makeBuyer({ districtId: aziziyah.id });
  const beforePrice = await post(priceBuyer, base(priceBuyer.siteId, { lines: [line(xo1.json.offer.id, 5)] }));
  await X.c.patch(`/api/v1/supplier/offers/${xo1.json.offer.id}`, { priceHalalas: 1200 });
  const afterPrice = await priceBuyer.c.get(`/api/v1/orders/${beforePrice.json.order.id}`);
  check("Changing a price later never rewrites an existing order (snapshot)", afterPrice.json.order.items[0].unitPriceHalalas === 900 && afterPrice.json.order.goodsHalalas === 4500);
  check("…but new searches use the new price", (await search()).json.offers.find((o: { supplier: { id: string } }) => o.supplier.id === X.id).unitPriceHalalas === 1200);
  await X.c.patch(`/api/v1/supplier/offers/${xo1.json.offer.id}`, { priceHalalas: 900 });

  // ───── G. Cancellation and access to orders ─────
  section("G. Order access and cancellation");
  check("Another buyer cannot read the order (404)", (await stranger.c.get(`/api/v1/orders/${o1.json.order.id}`)).status === 404);
  check("…or cancel it (404)", (await stranger.c.post(`/api/v1/orders/${o1.json.order.id}/cancel`, {})).status === 404);
  check("Buyer sees only their own orders in the list", (await B1.c.get("/api/v1/orders")).json.orders.length === 1);
  const cancelled = await B1.c.post(`/api/v1/orders/${o1.json.order.id}/cancel`, { reason: "changed my mind" });
  check("The buyer cancels before dispatch", cancelled.status === 200 && cancelled.json.order.status === "CANCELLED" && cancelled.json.order.events.some((e: { type: string }) => e.type === "CANCELLED"));
  check("Cancelling twice → 409", (await B1.c.post(`/api/v1/orders/${o1.json.order.id}/cancel`, {})).status === 409);
  const again = await post(B1, base(B1.siteId), idem());
  check("A cancelled order no longer counts against the limit (a new one is now accepted)", again.status === 201, again.json);
  await db.order.update({ where: { id: again.json.order.id }, data: { status: "OUT_FOR_DELIVERY" } });
  check("Once out for delivery, cancelling is refused (409)", (await B1.c.post(`/api/v1/orders/${again.json.order.id}/cancel`, {})).status === 409);

  // ───── H. What the supplier may see ─────
  section("H. Supplier inbox privacy");
  const priv = await makeBuyer({ districtId: aziziyah.id });
  const pv = must(await post(priv, base(priv.siteId, { lines: [line(xo1.json.offer.id, 40)] })), "place order for privacy test");
  const sList = await X.c.get("/api/v1/supplier/orders");
  const sOrder = sList.json.orders.find((o: { orderNo: string }) => o.orderNo === pv.json.order.orderNo);
  check("The supplier's inbox shows the new order", sList.status === 200 && !!sOrder);
  check("Donor is shown by first name only", sOrder.donor === "Khalid" && sOrder.anonymous === false);
  const sJson = JSON.stringify(sList.json); // the whole inbox, including orders already past acceptance
  const oJson = JSON.stringify(sOrder); // this one still awaits acceptance
  check("Nowhere in the inbox: any buyer's last name or mobile (only ever the first name)", !sJson.includes("Alotaibi") && !sJson.includes(priv.mobile) && !sJson.includes(B1.mobile) && !sJson.includes(racer.mobile), "leak");
  check("Before acceptance the recipient's name and mobile are hidden", !oJson.includes("Ahmad Recipient") && !oJson.includes("0501234567") && !oJson.includes("+966501234567"), oJson);
  check("…and so are the exact pin, landmark and access notes", sOrder.destination === null && !oJson.includes("21.4225") && !oJson.includes("blue gate") && !oJson.includes("Gate 2"));
  const revealedInInbox = sList.json.orders.find((o: { status: string }) => o.status === "OUT_FOR_DELIVERY");
  check("(Contrast) an order already out for delivery does carry the delivery details", !!revealedInInbox?.destination?.recipientMobile);
  check("Fee and net-after-fee are shown up front: fee SAR 20, VAT SAR 3, keeps SAR 357", sOrder.feePreview.fee === 2000 && sOrder.feePreview.feeVat === 300 && sOrder.feePreview.keep === 35_700 && sOrder.buyerTier === 1, sOrder.feePreview);
  check("Another supplier cannot open it (404)", (await Y.c.get(`/api/v1/supplier/orders/${pv.json.order.id}`)).status === 404);
  const anonB = await makeBuyer({ districtId: aziziyah.id });
  const anonO = await post(anonB, base(anonB.siteId, { anonymous: true, lines: [line(xo1.json.offer.id, 5)] }));
  check("An anonymous donor is not named to the supplier at all", (await X.c.get(`/api/v1/supplier/orders/${anonO.json.order.id}`)).json.order.donor === null);
  await db.order.update({ where: { id: pv.json.order.id }, data: { status: "ACCEPTED" } });
  const revealed = (await X.c.get(`/api/v1/supplier/orders/${pv.json.order.id}`)).json.order;
  check("After acceptance the supplier gets recipient name, mobile and pin (still no donor mobile)", revealed.destination?.recipientMobile === "+966501234567" && revealed.destination.lat === 21.4225 && !JSON.stringify(revealed).includes(priv.mobile));

  // ───── I. Admin ─────
  section("I. Admin: orders and district rules");
  await resetStaff(OPS_MOBILE);
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: {}, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);
  const aList = await ops.get("/api/v1/admin/orders");
  check("Ops can list all orders and sees the buyer's real name", aList.status === 200 && aList.json.orders.some((o: { buyer: { name: string } }) => o.buyer?.name === "Khalid Alotaibi"));
  check("A buyer cannot (403)", (await stranger.c.get("/api/v1/admin/orders")).status === 403);
  check("Ops can filter by status", (await ops.get("/api/v1/admin/orders?status=CANCELLED")).json.orders.every((o: { status: string }) => o.status === "CANCELLED"));
  check("Ops can open one order", (await ops.get(`/api/v1/admin/orders/${pv.json.order.orderNo}`)).json?.order?.orderNo === pv.json.order.orderNo);

  const slug = `t2-${rnd(6)}`;
  const nd = must(await ops.post("/api/v1/admin/districts", { slug, nameAr: "حي اختبار", nameEn: "Test district", sortOrder: 500 }), "create district");
  check("Ops creates a district", nd.status === 200 && nd.json.district.slug === slug);
  check("Duplicate slug → 409", (await ops.post("/api/v1/admin/districts", { slug, nameAr: "حي آخر", nameEn: "Other" })).status === 409);
  check("Closing time before opening time → 422", (await ops.post("/api/v1/admin/districts", { slug: `t2-${rnd(6)}`, nameAr: "حي", nameEn: "Bad hours", deliveryStart: "18:00", deliveryEnd: "09:00" })).status === 422);
  const did = nd.json.district.id as string;
  await zone(X.id, did, 1000, 24);
  check("Restricting a district needs a reason (422)", (await ops.patch(`/api/v1/admin/districts/${did}`, { restricted: true })).status === 422);
  const restr = await ops.patch(`/api/v1/admin/districts/${did}`, { restricted: true, restrictedReason: "Road closure" });
  check("Restricting works…", restr.status === 200 && restr.json.district.restricted === true);
  check("…and switches every supplier's zone there off at once", (await db.coverageZone.findFirstOrThrow({ where: { supplierId: X.id, districtId: did } })).active === false);
  check("…and search there is refused", (await b0.c.post("/api/v1/offers/search", { districtId: did, qtyPacks: 10 })).json?.error?.code === "RESTRICTED_ZONE");
  check("Ops can widen delivery hours and set a larger GPS radius", (await ops.patch(`/api/v1/admin/districts/${did}`, { restricted: false, deliveryStart: "07:00", deliveryEnd: "23:00", gpsRadiusM: 150 })).json?.district?.gpsRadiusM === 150);
  check("A buyer cannot edit districts (403)", (await stranger.c.patch(`/api/v1/admin/districts/${did}`, { restricted: true, restrictedReason: "x" })).status === 403);

  // ───── J. Database guarantees ─────
  section("J. Database guarantees");
  const attempt = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);
  const anyEvent = await db.orderEvent.findFirstOrThrow();
  check("Order timeline events cannot be edited", await attempt(() => db.orderEvent.update({ where: { id: anyEvent.id }, data: { note: "tamper" } })));
  check("…or deleted", await attempt(() => db.orderEvent.delete({ where: { id: anyEvent.id } })));
  check("An order whose total ≠ goods + delivery cannot be stored", await attempt(() => db.order.update({ where: { id: pv.json.order.id }, data: { totalHalalas: 1 } })));
  check("An offer priced at zero cannot be stored", await attempt(() => db.offer.update({ where: { id: yo.id }, data: { priceHalalas: 0 } })));
  const anyItem = await db.orderItem.findFirstOrThrow();
  check("An order line with zero quantity cannot be stored", await attempt(() => db.orderItem.update({ where: { id: anyItem.id }, data: { qtyPacks: 0 } })));
  check("A line total that disagrees with price × quantity cannot be stored", await attempt(() => db.orderItem.update({ where: { id: anyItem.id }, data: { lineTotalHalalas: 1 } })));
  check("A supplier cannot list the same brand and pack twice", await attempt(() => mkOffer(Y.id, { price: 1 + 50 })));
  check("Delivery hours must be sane", await attempt(() => db.district.update({ where: { id: did }, data: { deliveryStart: "22:00", deliveryEnd: "08:00" } })));

  // ───── K. Audit ─────
  section("K. Audit trail");
  const actions = new Set((await db.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 20 * 60_000) } }, select: { action: true } })).map((a) => a.action));
  for (const a of ["order.placed", "order.cancelled", "offer.created", "offer.updated", "offer.deleted", "zone.saved", "site.created", "site.deleted", "district.created", "district.updated"]) {
    check(`Audit has '${a}'`, actions.has(a));
  }
  finish();
}

main()
  .catch((e) => {
    console.error("\nverify crashed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined); // leave nothing behind for manual testing
    await db.$disconnect();
  });
