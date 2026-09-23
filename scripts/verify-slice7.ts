/**
 * End-to-end verification of slice 7 hardening (cursor pagination, recency-weighted ratings,
 * threshold-crossing ceiling-warning dedup) against a RUNNING dev server and the dev DB:
 *   npm run verify:7
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { listBuyerOrders, listSupplierOrders, supplierOrderStatusCounts } from "../src/server/orders";
import { listSupplierReviews, supplierRatingSummary } from "../src/server/reviews";
import { checkCeilingAndPause, generateInvoices, listSupplierInvoices, supplierExposureHalalas } from "../src/server/fees";

const FIN_MOBILE = "+966500000004"; // seeded ADMIN_FINANCE — same account verify-slice5.ts uses; scripts never run concurrently
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const supplierInApp = (supplierId: string, event: string) =>
  db.notification.count({ where: { event, channel: "IN_APP", user: { supplierMemberships: { some: { supplierId, role: "OWNER" } } } } });

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

async function makeBuyer() {
  const c = new Client();
  const mobile = newMobile();
  await login(c, mobile);
  await c.patch("/api/v1/me", { name: "Nasser Alotaibi" });
  return { c, mobile, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}

/** A bare-bones order row, created directly — enough to hang a Review or list-pagination fixture off of,
 *  without placing hundreds of real orders through the full flow (already covered by earlier slices). */
async function dummyOrder(supplierId: string, buyerId: string, districtId: string, status: "PAID" | "ACCEPTED" | "ASSIGNED" = "PAID", placedAt: Date = new Date()) {
  return db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId, supplierId, type: "DONATION", status,
      districtId, lat: PIN.lat, lng: PIN.lng, windowStart: new Date(), windowEnd: new Date(Date.now() + HOUR), acceptBy: new Date(Date.now() + 2 * HOUR),
      goodsHalalas: 5_000, deliveryHalalas: 500, totalHalalas: 5_500, vatHalalas: 717, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
      placedAt,
    },
  });
}

/** Same as slice 5/6's own dummyAccrual: a delivered+paid order plus its FeeAccrual, for exercising the
 *  fee module through ceiling/invoicing scenarios without a full delivery flow. */
async function dummyAccrual(supplierId: string, buyerId: string, districtId: string, amountHalalas: number, accruedAt: Date = new Date()) {
  const order = await dummyOrder(supplierId, buyerId, districtId, "PAID", accruedAt);
  const vatHalalas = Math.round((amountHalalas * 15) / 100);
  const accrual = await db.feeAccrual.create({ data: { orderId: order.id, supplierId, packetEqMilli: 1000, ratePerPacketHalalas: 50, amountHalalas, vatHalalas, accruedAt } });
  return { order, accrual, total: amountHalalas + vatHalalas };
}

async function dummyReview(supplierId: string, buyerId: string, districtId: string, stars: number, createdAt: Date) {
  const order = await dummyOrder(supplierId, buyerId, districtId, "PAID", createdAt);
  return db.review.create({ data: { orderId: order.id, supplierId, buyerId, stars, language: "AR", createdAt } });
}

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T7 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED", pauseReason: null } });
}

async function main() {
  console.log(`Verifying slice 7 against ${BASE}`);
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
  await resetStaff(FIN_MOBILE);
  await db.user.upsert({ where: { mobile: FIN_MOBILE }, update: { roles: ["BUYER", "ADMIN_FINANCE"] }, create: { mobile: FIN_MOBILE, name: "Finance Reviewer", roles: ["BUYER", "ADMIN_FINANCE"] } });
  const fin = new Client();
  await login(fin, FIN_MOBILE);
  await enrol(fin);
  const buyer = await makeBuyer();
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٧", nameEn: `T7 Brand ${rnd(4)}`, sfdaRef: `T7-${rnd(8)}` } });

  // ───── B. Cursor pagination ─────
  section("B. Cursor pagination");

  const P = await makeSupplier("T7 P"); // pagination fixture, unrelated to the ceiling scenario below
  for (let i = 0; i < 5; i++) await dummyOrder(P.id, buyer.userId, az.id, "PAID", new Date(Date.now() - i * 1000));
  const page1 = await listBuyerOrders(buyer.userId, { limit: 2 });
  check("First page returns exactly `limit` rows with a cursor to continue", page1.items.length === 2 && page1.nextCursor !== null, page1);
  const page2 = await listBuyerOrders(buyer.userId, { limit: 2, cursor: page1.nextCursor! });
  check("Second page continues where the first left off, no overlap", page2.items.length === 2 && !page2.items.some((o) => page1.items.some((p) => p.id === o.id)));
  const page3 = await listBuyerOrders(buyer.userId, { limit: 2, cursor: page2.nextCursor! });
  check("Last page has the remainder and no further cursor", page3.items.length === 1 && page3.nextCursor === null, page3);
  const seenIds = new Set([...page1.items, ...page2.items, ...page3.items].map((o) => o.id));
  check("Walking every page visits each of the 5 rows exactly once", seenIds.size === 5);
  const wholePage = await listBuyerOrders(buyer.userId, { limit: 50 });
  check("A page bigger than the data has no next cursor", wholePage.items.length === 5 && wholePage.nextCursor === null);

  // Multi-status tab query (mirrors /supplier/orders' TABS): one cursor-correct query across several
  // statuses at once, not one paginated query per status merged in JS (that would break cursor anchoring).
  await dummyOrder(P.id, buyer.userId, az.id, "ACCEPTED");
  await dummyOrder(P.id, buyer.userId, az.id, "ACCEPTED");
  await dummyOrder(P.id, buyer.userId, az.id, "ASSIGNED");
  const activeP1 = await listSupplierOrders(P.id, ["ACCEPTED", "ASSIGNED"], { limit: 2 });
  check("Multi-status page 1: 2 rows, both from the requested statuses", activeP1.items.length === 2 && activeP1.items.every((o) => ["ACCEPTED", "ASSIGNED"].includes(o.status)));
  const activeP2 = await listSupplierOrders(P.id, ["ACCEPTED", "ASSIGNED"], { limit: 2, cursor: activeP1.nextCursor! });
  check("Multi-status page 2: the remaining row, cursor exhausted", activeP2.items.length === 1 && activeP2.nextCursor === null);
  const counts = await supplierOrderStatusCounts(P.id);
  check("Status counts are exact (groupBy), independent of the page size used to fetch them", (counts.ACCEPTED ?? 0) === 2 && (counts.ASSIGNED ?? 0) === 1 && (counts.PAID ?? 0) === 5, counts);

  // Reviews and fee-invoice pagination, same mechanism, different tables.
  for (let i = 0; i < 4; i++) await dummyReview(P.id, buyer.userId, az.id, 4, new Date(Date.now() - i * 1000));
  const revP1 = await listSupplierReviews(P.id, { limit: 2 });
  check("Review list paginates too", revP1.items.length === 2 && revP1.nextCursor !== null);
  const revAll = [...revP1.items];
  let revCursor = revP1.nextCursor;
  while (revCursor) {
    const next = await listSupplierReviews(P.id, { limit: 2, cursor: revCursor });
    revAll.push(...next.items);
    revCursor = next.nextCursor;
  }
  check("Walking every review page covers all 4 with no duplicates", new Set(revAll.map((r) => r.id)).size === 4, revAll.map((r) => r.id));

  await dummyAccrual(P.id, buyer.userId, az.id, 100, new Date(Date.now() - 40 * DAY));
  await dummyAccrual(P.id, buyer.userId, az.id, 100, new Date(Date.now() - 47 * DAY));
  await generateInvoices();
  const invP1 = await listSupplierInvoices(P.id, {}, { limit: 1 });
  check("Fee-invoice list paginates: 1 row plus a cursor when 2+ invoices exist", invP1.items.length === 1 && invP1.nextCursor !== null, invP1);

  // HTTP-level smoke test: the route wiring actually exposes cursor/nextCursor, not just the server fn.
  const httpOrders = must(await buyer.c.get("/api/v1/orders?cursor=" + page1.items[1].id), "GET /api/v1/orders?cursor=...");
  check("The orders API accepts ?cursor= and echoes nextCursor in its response shape", "nextCursor" in httpOrders.json && Array.isArray(httpOrders.json.orders));
  const htmlOlder = await buyer.c.get("/orders");
  check("The /orders page itself renders with no server error", htmlOlder.status === 200);

  // ───── C. Recency-weighted ratings ─────
  section("C. Recency-weighted supplier ratings");
  const R = await makeSupplier("T7 R");
  const zoneR = await db.coverageZone.create({ data: { supplierId: R.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  const offerR = await db.offer.create({ data: { supplierId: R.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
  await dummyReview(R.id, buyer.userId, az.id, 5, new Date(Date.now() - 400 * DAY));
  await dummyReview(R.id, buyer.userId, az.id, 5, new Date(Date.now() - 400 * DAY));
  await dummyReview(R.id, buyer.userId, az.id, 1, new Date());
  const summaryR = await supplierRatingSummary(R.id);
  check(
    "A fresh 1★ pulls the rating far below the 3.7 a simple average of (5,5,1) would give",
    summaryR.rating !== null && summaryR.rating < 2,
    summaryR,
  );
  const searchRes = must(await buyer.c.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 }), "offers search");
  const offerRow = (searchRes.json.offers as { supplier: { id: string }; rating: number | null }[]).find((o) => o.supplier.id === R.id);
  check("The same recency-weighted rating reaches the real search API buyers see", !!offerRow && offerRow.rating !== null && offerRow.rating < 2, offerRow);
  void zoneR; void offerR;

  // ───── D. Ceiling-warning dedup: genuine crossings, not calendar days ─────
  section("D. Ceiling-warning dedup by threshold-crossing");
  const W = await makeSupplier("T7 W", 25_000); // SAR 250 ceiling
  const past = new Date(Date.now() - 40 * DAY);
  await dummyAccrual(W.id, buyer.userId, az.id, 15_000, past); // 17,250 → 69%, still ok
  await checkCeilingAndPause(W.id);
  check("Under 70%: no warning yet", (await supplierInApp(W.id, "fee.ceiling_warn70")) === 0);

  await dummyAccrual(W.id, buyer.userId, az.id, 500, past); // 17,825 → 71.3%
  await checkCeilingAndPause(W.id);
  check("Past 70%: warn70 fires once", (await supplierInApp(W.id, "fee.ceiling_warn70")) === 1);
  await checkCeilingAndPause(W.id);
  check("Calling it again with nothing changed does not re-notify (same as before)", (await supplierInApp(W.id, "fee.ceiling_warn70")) === 1);
  const stillActiveW = await db.supplier.findUniqueOrThrow({ where: { id: W.id } });
  check("The supplier was only warned, never paused", stillActiveW.status === "ACTIVE");

  // Pay the invoice down through the REAL endpoints (confirmInvoicePayment is where the fix lives) so
  // exposure genuinely drops back to "ok" while the supplier was never paused — reinstateIfClear() never
  // runs for a supplier that was never PAUSED, so this is the one path that must record the recovery.
  await generateInvoices();
  const invW = await db.feeInvoice.findFirstOrThrow({ where: { supplierId: W.id }, orderBy: { issuedAt: "desc" } });
  const payForm = () => { const f = new FormData(); f.set("paymentDate", new Date().toISOString()); f.set("bankReference", "T7REF"); return f; };
  must(await W.c.req("POST", `/api/v1/supplier/fee-invoices/${invW.id}/submit-payment`, { form: payForm() }), "submit payment");
  must(await fin.post(`/api/v1/admin/fee-invoices/${invW.id}/confirm-payment`, {}), "confirm payment");
  check("Paying it off drops exposure back to 0", (await supplierExposureHalalas(W.id)) === 0);
  check("…and records a fee.ceiling_cleared marker even though the supplier was never paused", (await supplierInApp(W.id, "fee.ceiling_cleared")) === 1);

  await dummyAccrual(W.id, buyer.userId, az.id, 15_500, past); // fresh rise back past 70% of the (still 25,000) ceiling
  await checkCeilingAndPause(W.id);
  check(
    "A fresh rise past 70% after a genuine recovery warns again — the old calendar-day dedup would have missed this",
    (await supplierInApp(W.id, "fee.ceiling_warn70")) === 2,
  );
  await checkCeilingAndPause(W.id);
  check("…but sitting steady at the same band afterwards still does not spam a third warning", (await supplierInApp(W.id, "fee.ceiling_warn70")) === 2);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
