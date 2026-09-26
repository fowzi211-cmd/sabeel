/**
 * End-to-end verification of slice 9 (R07 alignment, acceptance + dispute rates, supplier profile page)
 * against a RUNNING dev server and the dev DB:   npm run verify:9
 * Needs `npm run db:seed` first. Creates throw-away data; re-runnable.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, rnd, section, type Res } from "./lib/harness";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const PIN = { lat: 21.4225, lng: 39.8262 };

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};

async function makeSupplier(name: string, status: "ACTIVE" | "PAUSED" = "ACTIVE") {
  const mobile = newMobile();
  const owner = await db.user.create({ data: { mobile, name: `${name} Owner`, roles: ["BUYER", "SUPPLIER_ADMIN"] } });
  const sup = await db.supplier.create({
    data: {
      type: "BRAND_COMPANY", status, legalNameAr: `مورّد ${name}`, legalNameEn: name, tradeName: name, crNumber: newCr() + rnd(0),
      contactName: `${name} Owner`, contactMobile: mobile, creditCeilingHalalas: 100_000, invoiceCycle: "WEEKLY",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  return { id: sup.id, name, ownerId: owner.id };
}
type Sup = Awaited<ReturnType<typeof makeSupplier>>;

async function dummyOrder(supplierId: string, buyerId: string, districtId: string, opts: { windowEnd?: Date; anonymous?: boolean } = {}) {
  const windowEnd = opts.windowEnd ?? new Date(Date.now() + HOUR);
  return db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId, supplierId, type: "DONATION", status: "PAID", districtId, lat: PIN.lat, lng: PIN.lng,
      windowStart: new Date(windowEnd.getTime() - HOUR), windowEnd, acceptBy: new Date(Date.now() + 2 * HOUR), anonymous: opts.anonymous ?? false,
      goodsHalalas: 5_000, deliveryHalalas: 500, totalHalalas: 5_500, vatHalalas: 717, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
    },
  });
}

/** An allocation row for a fresh order, in a given final status, offered `daysAgo` days back. */
async function allocation(sup: Sup, buyerId: string, districtId: string, status: "ACCEPTED" | "DECLINED" | "EXPIRED" | "OFFERED", daysAgo = 3) {
  const o = await dummyOrder(sup.id, buyerId, districtId);
  const offeredAt = new Date(Date.now() - daysAgo * DAY);
  await db.orderAllocation.create({ data: { orderId: o.id, supplierId: sup.id, seq: 1, status, totalHalalas: 5_500, offeredAt, acceptBy: new Date(offeredAt.getTime() + 2 * HOUR) } });
}

/** A DELIVERED order (on time), optionally with a delivery dispute in a given state. */
async function delivered(sup: Sup, buyerId: string, districtId: string, driverId: string, dispute?: { category: "SHORT" | "NON_PAYMENT"; outcome: "DISMISS" | null }) {
  const o = await dummyOrder(sup.id, buyerId, districtId, { windowEnd: new Date(Date.now() - 2 * DAY) });
  await db.delivery.create({ data: { orderId: o.id, driverId, status: "DELIVERED", attempts: 1, deliveredAt: new Date(Date.now() - 2 * DAY) } });
  if (dispute) {
    await db.dispute.create({
      data: {
        orderId: o.id, category: dispute.category, openedBy: dispute.category === "NON_PAYMENT" ? "SUPPLIER" : "BUYER", openedById: buyerId, note: "T9 test dispute",
        ...(dispute.outcome ? { status: "RESOLVED", outcome: dispute.outcome, resolvedById: buyerId, resolvedAt: new Date(), resolutionNote: "T9" } : {}),
      },
    });
  }
}

async function makeDriver(supplierId: string) {
  const u = await db.user.create({ data: { mobile: newMobile(), name: "T9 Driver", roles: ["BUYER", "DRIVER"] } });
  return db.driver.create({ data: { supplierId, userId: u.id, vehiclePlate: "TST 900" } });
}

async function review(sup: Sup, buyerId: string, districtId: string, stars: number, daysAgo = 0, opts: { anonymous?: boolean; comment?: string; timeliness?: number } = {}) {
  const o = await dummyOrder(sup.id, buyerId, districtId, { anonymous: opts.anonymous });
  return db.review.create({
    data: { orderId: o.id, buyerId, supplierId: sup.id, stars, language: "AR", comment: opts.comment ?? null, timeliness: opts.timeliness ?? null, createdAt: new Date(Date.now() - daysAgo * DAY) },
  });
}

async function cleanup() {
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T9 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED", pauseReason: null } });
}

async function main() {
  console.log(`Verifying slice 9 against ${BASE}`);
  if (!(await fetch(BASE + "/api/v1/health").catch(() => null))) {
    console.error("The dev server is not reachable. Start it with `npm run dev`.");
    process.exit(2);
  }
  await db.otpChallenge.deleteMany({});
  await cleanup();

  const anon = new Client();
  const az = ((await anon.get("/api/v1/districts")).json.districts as { id: string; slug: string }[]).find((d) => d.slug === "al-aziziyah")!;

  section("A. Fixtures");
  const buyerC = new Client();
  const buyerMobile = newMobile();
  await login(buyerC, buyerMobile);
  await buyerC.patch("/api/v1/me", { name: "Sultan Alghamdi" });
  const buyerId = (await db.user.findUniqueOrThrow({ where: { mobile: buyerMobile } })).id;

  // ───── B. Acceptance and dispute rates ─────
  section("B. Acceptance rate and dispute rate (R08)");
  const R = await makeSupplier("T9 Rates");
  const dR = await makeDriver(R.id);
  for (const s of ["ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "DECLINED", "EXPIRED"] as const) await allocation(R, buyerId, az.id, s); // 4 of 6 → 67%
  await allocation(R, buyerId, az.id, "OFFERED"); // still open: not counted
  await allocation(R, buyerId, az.id, "DECLINED", 100); // outside the 90-day window: not counted
  // 10 delivered: 2 real delivery disputes (1 open, 1 upheld-style), 1 dismissed, 1 non-payment → only 2 count → 20%
  await delivered(R, buyerId, az.id, dR.id, { category: "SHORT", outcome: null });
  await delivered(R, buyerId, az.id, dR.id, { category: "SHORT", outcome: null });
  await delivered(R, buyerId, az.id, dR.id, { category: "SHORT", outcome: "DISMISS" });
  await delivered(R, buyerId, az.id, dR.id, { category: "NON_PAYMENT", outcome: null });
  for (let i = 0; i < 6; i++) await delivered(R, buyerId, az.id, dR.id);
  const F = await makeSupplier("T9 Few"); // under the minimum sample on both
  const dF = await makeDriver(F.id);
  for (const s of ["ACCEPTED", "DECLINED", "ACCEPTED"] as const) await allocation(F, buyerId, az.id, s);
  for (let i = 0; i < 4; i++) await delivered(F, buyerId, az.id, dF.id);
  for (const s of [R, F]) await review(s, buyerId, az.id, 5, 0, { comment: "T9 seed" }); // any review so the profile has content

  const pr = must(await buyerC.get(`/api/v1/suppliers/${R.id}`), "profile R").json.supplier;
  check("Acceptance = 4 accepted ÷ 6 answered offers = 67% (open and >90-day offers ignored)", pr.acceptancePct === 67 && pr.acceptanceCount === 6, [pr.acceptancePct, pr.acceptanceCount]);
  check("Dispute rate = 2 real disputes ÷ 10 delivered = 20% (dismissed and non-payment ones don't count)", pr.disputePct === 20 && pr.disputeCount === 10, [pr.disputePct, pr.disputeCount]);
  const pf = must(await buyerC.get(`/api/v1/suppliers/${F.id}`), "profile F").json.supplier;
  check("Too few offers/deliveries → no figure (null), not a noisy percentage", pf.acceptancePct === null && pf.disputePct === null && pf.onTimePct === null, pf);
  check("On-time % is on the profile too (10 of 10 within the window)", pr.onTimePct === 100, pr.onTimePct);

  // ───── C. R07 rating maths ─────
  section("C. Rating: 180-day decay and the prior of 3 reviews (R07)");
  const W = await makeSupplier("T9 Weighted");
  for (const d of [200, 200, 0]) await review(W, buyerId, az.id, d === 0 ? 1 : 5, d, { timeliness: d === 0 ? 1 : 5 });
  const pw = must(await buyerC.get(`/api/v1/suppliers/${W.id}`), "profile W").json.supplier;
  const platform = (await db.review.aggregate({ where: { removedAt: null }, _avg: { stars: true } }))._avg.stars ?? 4;
  const w = Math.pow(0.5, 200 / 180);
  const expected = Math.round(((2 * w * 5 + 1 + 3 * platform) / (2 * w + 1 + 3)) * 10) / 10;
  check("Rating = (Σw·r + 3·platform mean) ÷ (Σw + 3) with w = 0.5^(age÷180)", Math.abs(pw.rating - expected) <= 0.1, [pw.rating, expected, platform]);
  check("Three reviews → rated, not 'New'", pw.rating !== null && pw.reviewCount === 3);
  check("Category averages use the same decay (timeliness: two old 5s, one fresh 1)", Math.abs(pw.categories.timeliness - Math.round(((2 * w * 5 + 1) / (2 * w + 1)) * 10) / 10) <= 0.1, pw.categories);
  check("A category nobody scored is null", pw.categories.packaging === null);

  // ───── D. The profile page and its privacy ─────
  section("D. Supplier profile: visibility and privacy");
  await review(R, buyerId, az.id, 4, 1, { anonymous: true, comment: "T9 anonymous comment" });
  await review(R, buyerId, az.id, 3, 2, { comment: "T9 named comment" });
  const revs = must(await buyerC.get(`/api/v1/suppliers/${R.id}/reviews`), "reviews").json.reviews as { buyerFirstName: string | null; comment: string | null; stars: number }[];
  check("Reviews show the buyer's FIRST name only", revs.some((r) => r.comment === "T9 named comment" && r.buyerFirstName === "Sultan"));
  check("An anonymous order's review shows no name at all", revs.some((r) => r.comment === "T9 anonymous comment" && r.buyerFirstName === null));
  check("No mobile, full name or ids of the buyer leak into the response", !/Alghamdi|\+966/.test(JSON.stringify(revs)) && !/buyerId|"buyer"/.test(JSON.stringify(revs)));
  const removed = await review(R, buyerId, az.id, 1, 0, { comment: "T9 removed one" });
  await db.review.update({ where: { id: removed.id }, data: { removedAt: new Date(), removeReason: "T9", removedById: buyerId } });
  const revs2 = must(await buyerC.get(`/api/v1/suppliers/${R.id}/reviews`), "reviews2").json.reviews as { comment: string | null }[];
  check("Removed reviews never appear", !revs2.some((r) => r.comment === "T9 removed one"));
  const html = await buyerC.get(`/suppliers/${R.id}`);
  check("The profile page renders for a signed-in buyer", html.status === 200 && html.text.includes("T9 Rates"), html.status);
  check("It shows the trust figures", /67/.test(html.text) && /20/.test(html.text));
  check("Anonymous visitors are sent to sign in", (await anon.get(`/suppliers/${R.id}`)).status !== 200);
  check("…and cannot read the API either (401)", (await anon.get(`/api/v1/suppliers/${R.id}`)).status === 401);
  const paused = await makeSupplier("T9 Paused", "PAUSED");
  check("A paused supplier has no profile (404)", (await buyerC.get(`/api/v1/suppliers/${paused.id}`)).status === 404 && (await buyerC.get(`/api/v1/suppliers/${paused.id}/reviews`)).status === 404);
  check("An unknown supplier id is a 404", (await buyerC.get(`/api/v1/suppliers/does-not-exist`)).status === 404);
  check("The profile page 404s for a paused supplier", (await buyerC.get(`/suppliers/${paused.id}`)).status === 404);

  // ───── E. Offers link to the profile ─────
  section("E. Offers link to the profile");
  const brand = await db.brand.create({ data: { nameAr: "علامة اختبار ٩", nameEn: `T9 Brand ${rnd(4)}`, sfdaRef: `T9-${rnd(8)}` } });
  await db.coverageZone.create({ data: { supplierId: R.id, districtId: az.id, deliveryFeeHalalas: 1000, leadTimeHours: 2 } });
  await db.offer.create({ data: { supplierId: R.id, brandId: brand.id, bottleMl: 500, bottlesPerPack: 20, packetEqMilli: 1000, priceHalalas: 1000 } });
  const search = must(await buyerC.post("/api/v1/offers/search", { districtId: az.id, qtyPacks: 1 }), "search").json.offers as { supplier: { id: string }; rating: number | null }[];
  const mine = search.find((o) => o.supplier.id === R.id);
  const prNow = must(await buyerC.get(`/api/v1/suppliers/${R.id}`), "profile R again").json.supplier;
  check("The offer's supplier id is exactly what the profile route takes, and its rating matches the profile's", !!mine && mine.rating !== null && mine.rating === prNow.rating, [mine?.rating, prNow.rating]);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
