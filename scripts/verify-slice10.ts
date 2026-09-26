/**
 * End-to-end verification of slice 10 (dispute response window: 48 h, one answer with an optional photo,
 * evidence access, admin view, reminder job) against a RUNNING dev server and the dev DB:   npm run verify:10
 * Needs `npm run db:seed` first. Run the dev server with JOBS_ENABLED=false so its own job loop can't race
 * the fixtures. Creates throw-away data; re-runnable.
 */
import { BASE, Client, check, db, enrol, finish, login, newCr, newMobile, resetStaff, rnd, section, type Res } from "./lib/harness";
import { sendDisputeResponseReminders } from "../src/server/payments";

const OPS_MOBILE = "+966500000002";
const HOUR = 3_600_000;
const PIN = { lat: 21.4225, lng: 39.8262 };
// A real 1×1 PNG: the upload check sniffs the bytes, not the file name.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const must = (r: Res, label: string): Res => {
  if (r.status >= 400) throw new Error(`setup step "${label}" failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r;
};
const inApp = (userId: string, event: string) => db.notification.count({ where: { userId, event, channel: "IN_APP" } });
const respondForm = (note: string, file?: { bytes: Buffer; name: string; type: string }) => {
  const f = new FormData();
  f.set("note", note);
  if (file) f.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return f;
};

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
  return { c, id: sup.id, userId: owner.id, name };
}
type Sup = Awaited<ReturnType<typeof makeSupplier>>;

async function makeBuyer(name: string) {
  const c = new Client();
  const mobile = newMobile();
  await login(c, mobile);
  await c.patch("/api/v1/me", { name });
  must(await c.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true }), "buyer terms");
  return { c, userId: (await db.user.findUniqueOrThrow({ where: { mobile } })).id };
}
type Buyer = Awaited<ReturnType<typeof makeBuyer>>;

async function deliveredOrder(sup: Sup, buyer: Buyer, districtId: string) {
  return db.order.create({
    data: {
      orderNo: `SBL-TEST-${rnd(10)}`, buyerId: buyer.userId, supplierId: sup.id, type: "DONATION", status: "DELIVERED_DRIVER_CONFIRMED",
      districtId, lat: PIN.lat, lng: PIN.lng, windowStart: new Date(Date.now() - 2 * HOUR), windowEnd: new Date(Date.now() - HOUR), acceptBy: new Date(Date.now() + HOUR),
      goodsHalalas: 5_000, deliveryHalalas: 500, totalHalalas: 5_500, vatHalalas: 717, feePerPacketHalalas: 50, packetEqMilliTotal: 1000,
    },
  });
}

async function cleanup() {
  const admin = await db.user.findFirst({ where: { OR: [{ mobile: OPS_MOBILE }, { roles: { has: "SUPER_ADMIN" } }] } });
  if (admin) {
    await db.dispute.updateMany({
      where: { status: "OPEN", order: { supplier: { legalNameEn: { startsWith: "T10 " } } } },
      data: { status: "RESOLVED", outcome: "DISMISS", resolvedById: admin.id, resolvedAt: new Date(), resolutionNote: "verify cleanup" },
    });
  }
  await db.supplier.updateMany({ where: { legalNameEn: { startsWith: "T10 " }, status: { not: "OFFBOARDED" } }, data: { status: "OFFBOARDED", pauseReason: null } });
}

async function main() {
  console.log(`Verifying slice 10 against ${BASE}`);
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
  const S = await makeSupplier("T10 S");
  const other = await makeSupplier("T10 Other");
  const buyer = await makeBuyer("Faisal Alzahrani");

  // ───── B. Opening a delivery dispute starts the 48 h window ─────
  section("B. The response window opens with the dispute");
  const o1 = await deliveredOrder(S, buyer, az.id);
  const before = Date.now();
  must(await buyer.c.post(`/api/v1/orders/${o1.id}/report-problem`, { category: "SHORT", note: "Only half the packs arrived" }), "open dispute 1");
  const d1 = await db.dispute.findFirstOrThrow({ where: { orderId: o1.id } });
  const dueMs = (d1.responseDueAt?.getTime() ?? 0) - before;
  check("responseDueAt is set to about 48 hours after opening", dueMs > 47.9 * HOUR && dueMs < 48.1 * HOUR, dueMs / HOUR);
  const openedNote = await db.notification.findFirstOrThrow({ where: { userId: S.userId, event: "dispute.opened", channel: "IN_APP" } });
  check("The supplier was told, and the message names the 48-hour window", (await inApp(S.userId, "dispute.opened")) === 1 && /48/.test((openedNote.payload as { text?: string } | null)?.text ?? ""));
  const supplierPage = await S.c.get(`/supplier/orders/${o1.id}`);
  check("The supplier's order page renders with the response form", supplierPage.status === 200);

  // ───── C. The supplier answers once ─────
  section("C. One answer, with an optional photo");
  const post = (c: Client, orderId: string, form: FormData) => c.req("POST", `/api/v1/supplier/orders/${orderId}/dispute/respond`, { form });
  check("A note under 5 characters is refused (422)", (await post(S.c, o1.id, respondForm("no"))).status === 422);
  check("Another supplier cannot answer for this order (404)", (await post(other.c, o1.id, respondForm("this is not our order at all"))).status === 404);
  check("The buyer cannot use the supplier route (403)", (await post(buyer.c, o1.id, respondForm("I am the buyer, hello there"))).status === 403);
  check("A non-image 'photo' is refused and nothing is saved (422)", (await post(S.c, o1.id, respondForm("We delivered the full order", { bytes: Buffer.from("hello, not an image"), name: "x.png", type: "image/png" }))).status === 422);
  check("…and the dispute is still unanswered after that refusal", (await db.dispute.findUniqueOrThrow({ where: { id: d1.id } })).supplierRespondedAt === null);
  const ok = await post(S.c, o1.id, respondForm("We delivered all 10 packs; the driver photo shows the full load.", { bytes: PNG, name: "load.png", type: "image/png" }));
  check("A real answer with a photo is accepted", ok.status === 200, ok.json);
  const d1b = await db.dispute.findUniqueOrThrow({ where: { id: d1.id } });
  check("The response, time, author and photo are stored", !!d1b.supplierResponse?.includes("10 packs") && !!d1b.supplierRespondedAt && d1b.supplierRespondedById === S.userId && !!d1b.responseFileKey && d1b.responseMime === "image/png");
  check("The dispute itself is unchanged: still OPEN, no outcome (only an admin decides)", d1b.status === "OPEN" && d1b.outcome === null);
  check("A second answer → 409 ALREADY_RESPONDED", (await post(S.c, o1.id, respondForm("actually one more thing to add"))).json?.error?.code === "ALREADY_RESPONDED");
  check("The buyer was told the supplier responded", (await inApp(buyer.userId, "dispute.supplier_responded")) === 1);

  // ───── D. Who can see the answer and the photo ─────
  section("D. Visibility");
  const ev = `/api/v1/disputes/${d1.id}/evidence`;
  const evBuyer = await buyer.c.get(ev), evSup = await S.c.get(ev), evOps = await ops.get(ev);
  check("The buyer, the supplier and staff can open the photo", [evBuyer, evSup, evOps].every((r) => r.status === 200 && r.headers.get("content-type") === "image/png"), [evBuyer.status, evSup.status, evOps.status]);
  check("It is served private, no-store and nosniff", evBuyer.headers.get("cache-control") === "private, no-store" && evBuyer.headers.get("x-content-type-options") === "nosniff");
  check("Another supplier gets 404 and a visitor gets 401", (await other.c.get(ev)).status === 404 && (await anon.get(ev)).status === 401);
  const buyerOrder = must(await buyer.c.get(`/api/v1/orders/${o1.id}`), "buyer order").json.order;
  const bd = (buyerOrder.disputes as { supplierResponse: string | null; hasEvidence: boolean }[])[0];
  check("The buyer's order shows the supplier's answer and that a photo exists — never the file key", !!bd.supplierResponse && bd.hasEvidence === true && !/dispute-evidence/.test(JSON.stringify(buyerOrder)));
  check("The buyer's order page renders", (await buyer.c.get(`/orders/${o1.id}`)).status === 200);
  const adminOrder = await ops.get(`/admin/orders/${o1.id}`);
  check("The admin order page shows the supplier's answer", adminOrder.status === 200 && adminOrder.text.includes("10 packs"));
  const queue = await ops.get("/admin/disputes");
  check("The admin queue renders and shows the response state column", queue.status === 200 && /Responded|ردّ/.test(queue.text));

  // ───── E. The window closes ─────
  section("E. After 48 hours");
  const o2 = await deliveredOrder(S, buyer, az.id);
  must(await buyer.c.post(`/api/v1/orders/${o2.id}/report-problem`, { category: "DAMAGED", note: "Two bottles were cracked" }), "open dispute 2");
  const d2 = await db.dispute.findFirstOrThrow({ where: { orderId: o2.id } });
  await db.dispute.update({ where: { id: d2.id }, data: { responseDueAt: new Date(Date.now() - HOUR) } });
  check("Answering after the deadline → 409 RESPONSE_WINDOW_CLOSED", (await post(S.c, o2.id, respondForm("sorry we are late replying"))).json?.error?.code === "RESPONSE_WINDOW_CLOSED");
  const adminOrder2 = await ops.get(`/admin/orders/${o2.id}`);
  check("The admin sees 'did not respond in time' on that dispute", adminOrder2.status === 200 && /did not respond in time|لم يردّ/.test(adminOrder2.text));
  check("The supplier's order page no longer offers the form after the deadline", !/dispute\/respond/.test((await S.c.get(`/supplier/orders/${o2.id}`)).text));

  // ───── F. Reminder job ─────
  section("F. Reminder before the window closes");
  const o3 = await deliveredOrder(S, buyer, az.id), o4 = await deliveredOrder(S, buyer, az.id);
  must(await buyer.c.post(`/api/v1/orders/${o3.id}/report-problem`, { category: "LATE", note: "Arrived hours late" }), "open dispute 3");
  must(await buyer.c.post(`/api/v1/orders/${o4.id}/report-problem`, { category: "WRONG_BRAND", note: "Wrong brand delivered" }), "open dispute 4");
  const d3 = await db.dispute.findFirstOrThrow({ where: { orderId: o3.id } });
  await db.dispute.update({ where: { id: d3.id }, data: { responseDueAt: new Date(Date.now() + 6 * HOUR) } }); // 6 h left: inside the 12 h reminder mark
  // o4 keeps its full ~48 h: too early to remind. o1 is answered, o2 is past due: neither is reminded.
  const r1 = await sendDisputeResponseReminders();
  const remOf = (orderId: string) => db.notification.count({ where: { userId: S.userId, event: "dispute.response_reminder", channel: "IN_APP", payload: { path: ["orderId"], equals: orderId } } });
  check("The dispute with 6 h left gets exactly one reminder", r1.reminded >= 1 && (await remOf(o3.id)) === 1, r1);
  check("Not yet due (48 h left), already answered, and already past due: no reminders", (await remOf(o4.id)) === 0 && (await remOf(o1.id)) === 0 && (await remOf(o2.id)) === 0);
  await sendDisputeResponseReminders();
  check("Running the job again does not remind twice (idempotent)", (await remOf(o3.id)) === 1);

  // ───── G. The admin still decides, and non-payment disputes have no response step ─────
  section("G. Decision and scope");
  const resolved = await ops.post(`/api/v1/admin/disputes/${d1.id}/resolve`, { outcome: "DISMISS", resolutionNote: "Supplier's photo shows the full load" });
  check("An answered dispute is decided by the admin as before", resolved.status === 200, resolved.json);
  const o5 = await deliveredOrder(S, buyer, az.id);
  await db.order.update({ where: { id: o5.id }, data: { status: "CONFIRMED_BY_BOTH" } });
  await db.dispute.create({ data: { orderId: o5.id, category: "NON_PAYMENT", openedBy: "SUPPLIER", openedById: S.userId, note: "T10 non-payment" } });
  check("A non-payment dispute has no response step (404)", (await post(S.c, o5.id, respondForm("responding to my own report"))).status === 404);

  await cleanup();
  finish();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nVerification aborted:", e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
