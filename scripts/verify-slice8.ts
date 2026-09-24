/**
 * End-to-end verification of slice 8 (on-time delivery %, payment totals across every page and for all
 * suppliers, review flagging) against a RUNNING dev server and the dev DB:   npm run verify:8
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";

const OPS_MOBILE = "+966500000002"; // seeded ADMIN_OPS (same account verify-slice6.ts uses; scripts never run concurrently)
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });

async function makeSupplier(name: string) {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: "BRAND_COMPANY", status: "ACTIVE", legalNameAr: `مورّد ${name}`, legalNameEn: name, tradeName: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 100_000, invoiceCycle: "WEEKLY",
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
type Sup = Awaited<ReturnType<typeof makeSupplier>>;

async function dummyOrder(supplierId: string, buyerId: string, districtId: string, windowEnd = new Date(Date.now() + HOUR)) {
  return db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId, supplierId, type: "DONATION", status: "PAID", districtId, lat: PIN.lat, lng: PIN.lng,
      windowStart: new Date(windowEnd.getTime() - HOUR), windowEnd, acceptBy: new Date(Date.now() + 2 * HOUR),
      goodsHalalas: 5_000, deliveryHalalas: 500, totalHalalas: 5_500, vatHalalas: 717, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
    },
  });
}

/** A DELIVERED delivery `minutesLate` after the order's window closed, `daysAgo` days back. */
async function deliveredOrder(sup: Sup, buyerId: string, districtId: string, driverId: string, minutesLate: number, daysAgo = 2) {
  const windowEnd = new Date(Date.now() - daysAgo * DAY);
  const order = await dummyOrder(sup.id, buyerId, districtId, windowEnd);
  await db.delivery.create({ data: { orderId: order.id, driverId, status: "DELIVERED", attempts: 1, deliveredAt: new Date(windowEnd.getTime() + minutesLate * 60_000) } });
}

async function makeDriver(supplierId: string) {
  const u = await db.user.create({ data: { mobile: newMobile(), name: "T8 Driver", roles: ["BUYER", "DRIVER"] } });
  return db.driver.create({ data: { supplierId, userId: u.id, vehiclePlate: "TST 800" } });
}

async function withOffer(sup: Sup, districtId: string, brandId: string) {
  await db.coverageZone.create({ data: { supplierId: sup.id, districtId, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  await db.offer.create({ data: { supplierId: sup.id, brandId, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
}

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T8 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED", pauseReason: null } });
}

async function main() {
  console.log(`Verifying slice 8 against ${BASE}`);
  if (!(await fetch(BASE + "/api/v1/health").catch(() => null))) {
    console.error("The dev server is not reachable. Start it with `npm run dev`.");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup();

  const anon = new Client();
  const az = ((await anon.get("/api/v1/districts")).json.districts as { id: string; slug: string }[]).find((d) => d.slug === "al-aziziyah")!;

  section("A. Fixtures");
  await resetStaff(OPS_MOBILE);
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: { roles: ["BUYER", "ADMIN_OPS"] }, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  const ops = new Client();
  await login(ops, OPS_MOBILE);
  await enrol(ops);
  const buyerC = new Client();
  const buyerMobile = newMobile();
  await login(buyerC, buyerMobile);
  await buyerC.patch("/api/v1/me", { name: "Khalid Alsulami" });
  const buyerId = (await db.user.findUniqueOrThrow({ where: { mobile: buyerMobile } })).id;
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٨", nameEn: `T8 Brand ${rnd(4)}`, sfdaRef: `T8-${rnd(8)}` } });

  // ───── B. On-time delivery % ─────
  section("B. On-time delivery % (R08)");
  const good = await makeSupplier("T8 Good"); // 5 of 5 within the window + tolerance
  const poor = await makeSupplier("T8 Poor"); // 3 of 5
  const few = await makeSupplier("T8 Few"); // only 4 deliveries: no figure yet
  const stale = await makeSupplier("T8 Stale"); // plenty of deliveries, all older than 90 days
  for (const s of [good, poor, few, stale]) await withOffer(s, az.id, brand.id);
  const dGood = await makeDriver(good.id), dPoor = await makeDriver(poor.id), dFew = await makeDriver(few.id), dStale = await makeDriver(stale.id);
  for (const m of [-20, 0, 10, 15, -5]) await deliveredOrder(good, buyerId, az.id, dGood.id, m); // 15 min late still counts
  for (const m of [0, 5, 10, 16, 90]) await deliveredOrder(poor, buyerId, az.id, dPoor.id, m);
  for (const m of [0, 0, 0, 0]) await deliveredOrder(few, buyerId, az.id, dFew.id, m);
  for (const m of [0, 0, 0, 0, 0, 0]) await deliveredOrder(stale, buyerId, az.id, dStale.id, m, 100);
  const search = must(await buyerC.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 }), "search").json.offers as { supplier: { id: string }; onTimePct: number | null; score: number }[];
  const row = (s: Sup) => search.find((o) => o.supplier.id === s.id);
  check("5 of 5 deliveries in the window (15 min late counts) → 100%", row(good)?.onTimePct === 100, row(good));
  check("3 of 5 → 60%", row(poor)?.onTimePct === 60, row(poor));
  check("Only 4 deliveries → no figure yet (null), not a noisy 100%", row(few)?.onTimePct === null, row(few));
  check("Deliveries older than 90 days do not count → null", row(stale)?.onTimePct === null, row(stale));
  check("With everything else equal, the more punctual supplier scores higher", (row(good)?.score ?? 0) > (row(poor)?.score ?? 1), [row(good)?.score, row(poor)?.score]);

  // ───── C. Payment totals across every page ─────
  section("C. Payment totals: per supplier and for all");
  const P = await makeSupplier("T8 P");
  const Q = await makeSupplier("T8 Q");
  const mkPay = async (sup: Sup, status: "RECEIVED" | "DUE") => {
    const o = await dummyOrder(sup.id, buyerId, az.id);
    await db.paymentRecord.create({ data: { orderId: o.id, transactionNo: `SBL-PAY-T8-${rnd(10)}`, status, amountHalalas: 5_500, dueAt: new Date(Date.now() + DAY) } });
  };
  for (let i = 0; i < 55; i++) await mkPay(P, "RECEIVED");
  for (let i = 0; i < 5; i++) await mkPay(P, "DUE");
  for (let i = 0; i < 3; i++) await mkPay(Q, "RECEIVED");
  // fee 50 + VAT round(7.5)=8 → supplier keeps 5,500 - 58 = 5,442 per received payment
  const list = must(await P.c.get("/api/v1/supplier/payments"), "supplier payments").json;
  check("The page holds 50 rows…", list.payments.length === 50 && list.nextCursor !== null);
  check("…but the totals cover all 60 payments", list.totals.count === 60, list.totals.count);
  check("55 received, worth exactly 55 × 5,500", list.totals.received.count === 55 && list.totals.received.halalas === 55 * 5_500, list.totals.received);
  check("What the supplier kept is 55 × 5,442, fee and VAT split out", list.totals.received.keptHalalas === 55 * 5_442 && list.totals.received.feeHalalas === 55 * 50 && list.totals.received.feeVatHalalas === 55 * 8, list.totals.received);
  const dueOnly = must(await P.c.get("/api/v1/supplier/payments?status=DUE"), "due filter").json;
  check("Totals follow the filter: status=DUE → 5 payments, nothing received", dueOnly.totals.count === 5 && dueOnly.totals.received.count === 0, dueOnly.totals);
  const page = await P.c.get("/supplier/payments");
  check("The supplier Payments page renders", page.status === 200, page.status);

  const all = must(await ops.get("/api/v1/admin/payments/summary"), "admin summary").json;
  type Line = { supplierId: string; totals: { count: number; received: { count: number; keptHalalas: number } } };
  const lineP = (all.suppliers as Line[]).find((s) => s.supplierId === P.id), lineQ = (all.suppliers as Line[]).find((s) => s.supplierId === Q.id);
  check("Admin sees each supplier's own line, identical to the supplier's own numbers", lineP?.totals.count === 60 && lineP.totals.received.keptHalalas === 55 * 5_442 && lineQ?.totals.received.count === 3, [lineP?.totals, lineQ?.totals]);
  const sumCount = (all.suppliers as Line[]).reduce((s, x) => s + x.totals.count, 0);
  const sumKept = (all.suppliers as Line[]).reduce((s, x) => s + x.totals.received.keptHalalas, 0);
  check("The all-suppliers figure equals the sum of the per-supplier lines", all.overall.count === sumCount && all.overall.received.keptHalalas === sumKept, [all.overall.count, sumCount]);
  check("…and includes at least these 63 payments", all.overall.count >= 63);
  check("The admin Payments page renders", (await ops.get("/admin/payments")).status === 200);
  check("A supplier cannot read the platform-wide summary", (await P.c.get("/api/v1/admin/payments/summary")).status === 403);
  check("Nor can a buyer", (await buyerC.get("/api/v1/admin/payments/summary")).status === 403);

  // ───── D. Review flagging ─────
  section("D. Review flagging (supplier report → admin decision)");
  const F = await makeSupplier("T8 F");
  const G = await makeSupplier("T8 G");
  const mkReview = async (sup: Sup) => {
    const o = await dummyOrder(sup.id, buyerId, az.id);
    return db.review.create({ data: { orderId: o.id, buyerId, supplierId: sup.id, stars: 1, language: "AR", comment: "T8 unfair" } });
  };
  const r1 = await mkReview(F), r2 = await mkReview(F), r3 = await mkReview(F);
  check("A reason under 5 characters is refused (422)", (await F.c.post(`/api/v1/supplier/reviews/${r1.id}/flag`, { reason: "bad" })).status === 422);
  check("Another supplier cannot flag it (404)", (await G.c.post(`/api/v1/supplier/reviews/${r1.id}/flag`, { reason: "not even my review" })).status === 404);
  const flagged = await F.c.post(`/api/v1/supplier/reviews/${r1.id}/flag`, { reason: "This buyer never ordered from us; wrong supplier" });
  check("The owner flags it", flagged.status === 200, flagged.json);
  check("Flagging twice → 409 ALREADY_FLAGGED", (await F.c.post(`/api/v1/supplier/reviews/${r1.id}/flag`, { reason: "again please look" })).json?.error?.code === "ALREADY_FLAGGED");
  check("Flagging never hides it: the review is still published", (await db.review.findUniqueOrThrow({ where: { id: r1.id } })).removedAt === null);
  const queue = must(await ops.get("/api/v1/admin/reviews?flagged=1"), "flagged list").json.reviews as { id: string; flag: { status: string; reason: string } }[];
  check("It shows up in the admin's flagged queue with the reason", queue.some((r) => r.id === r1.id && r.flag.status === "OPEN" && r.flag.reason.includes("never ordered")));
  check("…and only open flags are in that queue", queue.every((r) => r.flag.status === "OPEN"));
  const dash = await ops.get("/admin");
  check("The dashboard has a 'reported reviews' tile", dash.status === 200 && /admin\/reviews\?flagged=1/.test(dash.text));
  check("The flagged filter page renders", (await ops.get("/admin/reviews?flagged=1")).status === 200);
  check("A supplier cannot use the admin dismiss route (403)", (await F.c.post(`/api/v1/admin/reviews/${r1.id}/dismiss-flag`, { note: "let me dismiss" })).status === 403);
  check("Dismissing needs a note (422)", (await ops.post(`/api/v1/admin/reviews/${r1.id}/dismiss-flag`, {})).status === 422);
  must(await ops.post(`/api/v1/admin/reviews/${r1.id}/dismiss-flag`, { note: "The order is genuinely theirs; the review follows the rules." }), "dismiss");
  const fl1 = await db.reviewFlag.findUniqueOrThrow({ where: { reviewId: r1.id } });
  check("Dismissed: the flag is closed and the review stays published", fl1.status === "DISMISSED" && !!fl1.resolvedAt && (await db.review.findUniqueOrThrow({ where: { id: r1.id } })).removedAt === null);
  check("The supplier was told, with the admin's reason", (await inApp(F.userId, "review.flag_dismissed")) === 1);
  check("Dismissing again → 409", (await ops.post(`/api/v1/admin/reviews/${r1.id}/dismiss-flag`, { note: "second time" })).status === 409);
  check("It has left the flagged queue", !(must(await ops.get("/api/v1/admin/reviews?flagged=1"), "queue2").json.reviews as { id: string }[]).some((r) => r.id === r1.id));

  must(await F.c.post(`/api/v1/supplier/reviews/${r2.id}/flag`, { reason: "Contains abusive language about our driver" }), "flag r2");
  must(await ops.post(`/api/v1/admin/reviews/${r2.id}/remove`, { reason: "Abusive language" }), "remove r2");
  const fl2 = await db.reviewFlag.findUniqueOrThrow({ where: { reviewId: r2.id } });
  check("Removing a flagged review resolves its flag as UPHELD", fl2.status === "UPHELD" && !!fl2.resolvedAt);
  check("A removed review can no longer be flagged (409)", (await F.c.post(`/api/v1/supplier/reviews/${r2.id}/flag`, { reason: "already removed one" })).status === 409);
  check("Removing an UN-flagged review still works as before", (await ops.post(`/api/v1/admin/reviews/${r3.id}/remove`, { reason: "policy" })).status === 200);
  check("The supplier's Reviews page renders with flag states", (await F.c.get("/supplier/reviews")).status === 200);
  check("Audit has review.flagged and review.flag_dismissed", (await db.auditLog.count({ where: { action: "review.flagged" } })) > 0 && (await db.auditLog.count({ where: { action: "review.flag_dismissed" } })) > 0);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
