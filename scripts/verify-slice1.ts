/**
 * End-to-end verification of slice 1 against a RUNNING dev server (npm run dev) and the dev DB.
 *   npm run verify
 * It drives the real HTTP API with cookie jars and also probes the database-level guarantees
 * (append-only tables, immutable agreements). It creates throw-away users/suppliers with random
 * numbers, so it can be re-run. Set VERIFY_PUBLISH=1 to also publish a future-dated agreement
 * version (immutable, so it is opt-in).
 */
import { PrismaClient } from "@prisma/client";
import * as OTPAuth from "otpauth";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3020";
const db = new PrismaClient();
const ADMIN_MOBILE = process.env.SEED_SUPERADMIN_MOBILE ?? "+966500000001";
const OPS_MOBILE = "+966500000002";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);

// ───────────── tiny HTTP client with a cookie jar ─────────────
interface Res {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  headers: Headers;
}
class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, opts: { body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(text);
    } catch {
      /* html or binary */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p: string, h?: Record<string, string>) => this.req("GET", p, { headers: h });
  post = (p: string, body?: unknown, h?: Record<string, string>) => this.req("POST", p, { body: body ?? {}, headers: h });
  patch = (p: string, body?: unknown) => this.req("PATCH", p, { body });
  del = (p: string) => this.req("DELETE", p);
}

// ───────────── helpers ─────────────
const rnd = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const newMobile = () => `+9665${rnd(8)}`;
const newCr = () => `10${rnd(8)}`;
const newVat = () => `3${rnd(13)}3`;
const totpFor = (b32: string, ts = Date.now()) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(b32), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: ts });

async function login(c: Client, mobile: string) {
  const r1 = await c.post("/api/v1/auth/otp/request", { mobile, lang: "AR" });
  if (r1.status !== 200) throw new Error(`otp request failed: ${r1.status} ${r1.text}`);
  const r2 = await c.post("/api/v1/auth/otp/verify", { mobile, code: r1.json.devCode, lang: "AR" });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${r2.status} ${r2.text}`);
  return r2.json as { next: string; isNew: boolean; user: { id: string; roles: string[] } };
}
async function enrol(c: Client): Promise<string> {
  const s = await c.post("/api/v1/me/2fa/setup");
  if (s.status !== 200) throw new Error(`2fa setup failed: ${s.status} ${s.text}`);
  const e = await c.post("/api/v1/me/2fa/enable", { token: totpFor(s.json.secretBase32) });
  if (e.status !== 200) throw new Error(`2fa enable failed: ${e.status} ${e.text}`);
  return s.json.secretBase32;
}
async function resetStaff(mobile: string) {
  await db.otpChallenge.deleteMany({ where: { mobile } });
  const u = await db.user.findUnique({ where: { mobile } });
  if (u) {
    await db.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
    await db.session.deleteMany({ where: { userId: u.id } });
  }
}
const pdf = (label = "doc") => new File([Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`)], "doc.pdf", { type: "application/pdf" });
const png = () =>
  new File([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000005000178a7ef510000000049454e44ae426082", "hex")], "scan.png", { type: "image/png" });
const upload = (c: Client, kind: string, file: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return c.req("POST", "/api/v1/supplier/documents", { form });
};
const VALID_IBAN = "SA0380000000608010167519";
/** A random Saudi IBAN with correct ISO 7064 check digits. */
function makeSaIban(): string {
  const body = `20${rnd(18)}`;
  const check = BigInt(98) - (BigInt(`${body}281000`) % BigInt(97)); // "SA00" → 28 10 00 00
  return `SA${String(check).padStart(2, "0")}${body}`;
}

// ───────────── the run ─────────────
async function main() {
  console.log(`Verifying slice 1 against ${BASE}`);
  const health = await fetch(BASE + "/api/v1/terms/BUYER_TERMS").catch(() => null);
  if (!health || health.status !== 200) {
    console.error("The dev server is not reachable or not seeded. Start it with `npm run dev` and `npm run db:seed:demo`.");
    process.exit(2);
  }

  // The dev DB only: forget old one-time codes so per-address rate limits from earlier runs don't interfere.
  await db.otpChallenge.deleteMany({});

  // ───── A. Public surface and input validation ─────
  section("A. Public surface, validation, rate limits, CSRF");
  const anon = new Client();
  const terms = await anon.get("/api/v1/terms/SUPPLIER_AGREEMENT");
  check("Agreements are readable without an account", terms.status === 200 && terms.json.current.version === "1.0");
  check("Unknown agreement type → 404", (await anon.get("/api/v1/terms/NOPE")).status === 404);
  const badMobile = await anon.post("/api/v1/auth/otp/request", { mobile: "0412345678" });
  check("Non-Saudi mobile rejected (422 MOBILE_INVALID)", badMobile.status === 422 && badMobile.json.error.code === "MOBILE_INVALID");
  check("Unauthenticated /me → 401", (await anon.get("/api/v1/me")).status === 401);
  const csrf = await anon.post("/api/v1/auth/otp/request", { mobile: newMobile() }, { origin: "https://evil.example" });
  check("Cross-origin write refused (CSRF)", csrf.status === 403, csrf.status);

  const m0 = newMobile();
  const first = await anon.post("/api/v1/auth/otp/request", { mobile: m0 });
  check("OTP request succeeds and, in dev, echoes the code", first.status === 200 && /^\d{6}$/.test(first.json.devCode ?? ""));
  const again = await anon.post("/api/v1/auth/otp/request", { mobile: m0 });
  check("Second request inside 60 s → 429 OTP_COOLDOWN", again.status === 429 && again.json.error.code === "OTP_COOLDOWN");
  const wrong = first.json.devCode === "000000" ? "111111" : "000000";
  let last: Res | null = null;
  for (let i = 0; i < 5; i++) last = await anon.post("/api/v1/auth/otp/verify", { mobile: m0, code: wrong });
  check("Wrong codes are rejected", last!.status === 400 || last!.status === 429);
  const afterLock = await anon.post("/api/v1/auth/otp/verify", { mobile: m0, code: first.json.devCode });
  check("After 5 wrong guesses even the right code is locked out", afterLock.status === 429 && afterLock.json.error.code === "OTP_LOCKED", afterLock.json);

  // ───── B. Buyer account ─────
  section("B. Buyer account");
  const buyer = new Client();
  const buyerMobile = newMobile();
  const b = await login(buyer, buyerMobile);
  check("First code creates a buyer account", b.isNew && b.user.roles.join() === "BUYER");
  check("Cookie is httpOnly + SameSite=Lax", (await (async () => {
    const c2 = new Client();
    const m = newMobile();
    const r = await c2.post("/api/v1/auth/otp/request", { mobile: m });
    const v = await fetch(BASE + "/api/v1/auth/otp/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobile: m, code: r.json.devCode }) });
    const sc = v.headers.getSetCookie().find((x) => x.startsWith("sabeel_session=")) ?? "";
    return /httponly/i.test(sc) && /samesite=lax/i.test(sc);
  })()));
  check("PATCH /me saves the name", (await buyer.patch("/api/v1/me", { name: "خالد العتيبي" })).status === 200);
  const acc = await buyer.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true });
  check("Buyer accepts terms → certificate number", acc.status === 200 && /^SBL-AGR-\d{4}-\d{6}$/.test(acc.json.certificateNo), acc.json);
  const acc2 = await buyer.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "1.0", language: "AR", confirmRead: true });
  check("Accepting the same terms twice → 409", acc2.status === 409, acc2.status);
  check("Buyer cannot read the admin API (403)", (await buyer.get("/api/v1/admin/suppliers")).status === 403);
  check("Buyer cannot use the supplier API (403)", (await buyer.get("/api/v1/supplier/me")).status === 403);
  const stale = await buyer.post("/api/v1/terms/accept", { type: "BUYER_TERMS", version: "0.9", language: "AR", confirmRead: true });
  check("Accepting an outdated version → 409 TERMS_STALE", stale.status === 409 && stale.json.error.code === "TERMS_STALE");

  // ───── C. Supplier onboarding ─────
  section("C. Supplier onboarding (brand company)");
  const sup = new Client();
  const supMobile = newMobile();
  await login(sup, supMobile);
  await sup.patch("/api/v1/me", { name: "أحمد الحربي" });
  const cr = newCr();
  const application = {
    type: "BRAND_COMPANY", legalNameAr: "شركة سحاب للمياه", legalNameEn: "Sahab Water Co.", registrationKind: "CR",
    crNumber: cr, vatNumber: newVat(), contactName: "أحمد الحربي", contactMobile: supMobile, contactEmail: "ops@example.com",
  };
  const bad1 = await sup.post("/api/v1/supplier/apply", { ...application, crNumber: "123" });
  check("Invalid CR number → 422", bad1.status === 422, bad1.json);
  const bad2 = await sup.post("/api/v1/supplier/apply", { ...application, vatNumber: "123456789012345" });
  check("VAT number must start/end with 3 → 422", bad2.status === 422);
  const bad3 = await sup.post("/api/v1/supplier/apply", { ...application, legalNameAr: "Only English" });
  check("Arabic legal name required → 422", bad3.status === 422);
  const applied = await sup.post("/api/v1/supplier/apply", application);
  check("Valid application creates a DRAFT supplier", applied.status === 200 && applied.json.supplier.status === "DRAFT", applied.json);
  check("New supplier starts with SAR 250 ceiling and weekly billing", applied.json.supplier.creditCeilingHalalas === 25000 && applied.json.supplier.invoiceCycle === "WEEKLY");
  const supplierId: string = applied.json.supplier.id;

  const other = new Client();
  await login(other, newMobile());
  await other.patch("/api/v1/me", { name: "Someone Else" });
  const dup = await other.post("/api/v1/supplier/apply", { ...application, contactMobile: "0512345678" });
  check("Same CR number cannot be registered twice → 409", dup.status === 409 && dup.json.error.field === "crNumber", dup.json);

  const gate = await sup.get("/api/v1/supplier/me");
  check("New supplier role is blocked until two-step is set up (403 MFA_REQUIRED)", gate.status === 403 && gate.json.error.code === "MFA_REQUIRED");
  const me1 = await sup.get("/api/v1/me");
  check("…but /me still tells the UI enrolment is needed", me1.status === 200 && me1.json.mfaEnrolmentNeeded === true);

  const setup = await sup.post("/api/v1/me/2fa/setup");
  check("2FA setup returns a QR image and manual key", setup.status === 200 && setup.json.qrDataUrl.startsWith("data:image/png") && /^[A-Z2-7]+$/.test(setup.json.secretBase32));
  const badTok = await sup.post("/api/v1/me/2fa/enable", { token: "000000" });
  check("Wrong authenticator code refused", badTok.status === 400 && badTok.json.error.code === "TOTP_INVALID");
  const secret: string = setup.json.secretBase32;
  const okTok = await sup.post("/api/v1/me/2fa/enable", { token: totpFor(secret) });
  check("Correct authenticator code enables 2FA", okTok.status === 200);
  check("Supplier API now reachable", (await sup.get("/api/v1/supplier/me")).status === 200);
  const reSetup = await sup.post("/api/v1/me/2fa/setup");
  check("2FA cannot be re-enrolled by the session itself (409)", reSetup.status === 409);

  // documents
  const d1 = await upload(sup, "CR", pdf("cr"), { number: cr });
  check("PDF upload accepted", d1.status === 200 && d1.json.document.status === "UPLOADED" && !("fileKey" in d1.json.document), d1.json);
  const fake = await upload(sup, "VAT_CERT", new File([Buffer.from("MZ\x90\x00 not really a pdf")], "vat.pdf", { type: "application/pdf" }));
  check("Executable renamed .pdf refused (content sniffing)", fake.status === 422 && fake.json.error.code === "FILE_INVALID");
  const huge = await upload(sup, "VAT_CERT", new File([Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(9 * 1024 * 1024)])], "big.pdf", { type: "application/pdf" }));
  check("File over 8 MB refused", huge.status === 422, huge.status);
  const wrongKind = await upload(sup, "NATIONAL_ID", png());
  check("Document kind not allowed for this supplier type → 422", wrongKind.status === 422, wrongKind.json);
  const d2 = await upload(sup, "VAT_CERT", png(), { expiresAt: "2030-01-01" });
  check("PNG upload accepted", d2.status === 200);

  const dl = await sup.get(`/api/v1/files/${d1.json.document.id}`);
  check("Owner can download own document with safe headers", dl.status === 200 && dl.headers.get("content-type") === "application/pdf" && dl.headers.get("x-content-type-options") === "nosniff" && /no-store/.test(dl.headers.get("cache-control") ?? ""));
  check("Another user gets 404 (existence not revealed)", (await other.get(`/api/v1/files/${d1.json.document.id}`)).status === 404);
  check("Anonymous gets 401", (await anon.get(`/api/v1/files/${d1.json.document.id}`)).status === 401);

  // bank
  const badIban = await sup.post("/api/v1/supplier/bank-accounts", { iban: "SA0480000000608010167519", holderName: "شركة سحاب للمياه" });
  check("IBAN with a wrong check digit → 422", badIban.status === 422);
  const bank = await sup.post("/api/v1/supplier/bank-accounts", { iban: "sa03 8000 0000 6080 1016 7519", holderName: "شركة سحاب للمياه", bankName: "Demo Bank" });
  check("Valid IBAN accepted and normalised", bank.status === 200 && bank.json.bankAccount.iban === VALID_IBAN && bank.json.bankAccount.status === "PENDING");
  const bankId: string = bank.json.bankAccount.id;

  // submit gating + agreement
  const early = await sup.post("/api/v1/supplier/submit");
  check("Submit before signing the agreement → 422 INCOMPLETE listing 'agreement'", early.status === 422 && early.json.error.details.missing.includes("agreement"), early.json);

  const codeReq = await sup.post("/api/v1/terms/sign-code", { type: "SUPPLIER_AGREEMENT", version: "1.0" });
  check("Signing code sent (dev echo)", codeReq.status === 200 && /^\d{6}$/.test(codeReq.json.devCode ?? ""));
  check("Wrong signing type for this supplier → 403", (await sup.post("/api/v1/terms/sign-code", { type: "INDEPENDENT_AGREEMENT", version: "1.0" })).status === 403);
  const noAuth = await sup.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "AR", confirmRead: true, authorised: false, code: codeReq.json.devCode });
  check("Signing without 'authorised to bind' → 422", noAuth.status === 422 && noAuth.json.error.field === "authorised", noAuth.json);
  const wrongCode = await sup.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "AR", confirmRead: true, authorised: true, code: codeReq.json.devCode === "123456" ? "654321" : "123456" });
  check("Wrong signing code → 400 OTP_INVALID", wrongCode.status === 400 && wrongCode.json.error.code === "OTP_INVALID");
  const signed = await sup.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "EN", confirmRead: true, authorised: true, code: codeReq.json.devCode });
  check("Correct code signs the agreement", signed.status === 200 && signed.json.method === "CLICK_WRAP_OTP", signed.json);
  const certNo: string = signed.json.certificateNo;
  const reuse = await sup.post("/api/v1/terms/accept", { type: "SUPPLIER_AGREEMENT", version: "1.0", language: "EN", confirmRead: true, authorised: true, code: codeReq.json.devCode });
  check("A used signing code cannot be replayed", reuse.status === 400 || reuse.status === 409, reuse.status);

  const acceptance = await db.termsAcceptance.findUnique({ where: { certificateNo: certNo }, include: { termsDocument: true } });
  check("Evidence stored: language shown, hashes match the published text, signatory, OTP link",
    !!acceptance && acceptance.languageShown === "EN" && acceptance.sha256Ar === acceptance.termsDocument.sha256Ar && acceptance.signatoryName === "أحمد الحربي" && !!acceptance.otpChallengeId && acceptance.authorisedToBind);
  const cert = await sup.get(`/certificate/${certNo}`);
  check("Owner can open the certificate page", cert.status === 200 && cert.text.includes(certNo));
  check("Other users get 404 for it", (await other.get(`/certificate/${certNo}`)).status === 404);

  const meNow = await sup.get("/api/v1/supplier/me");
  check("Checklist says the application is ready", meNow.json.checklist.submitReady === true, meNow.json.checklist.blockers);
  const submit = await sup.post("/api/v1/supplier/submit");
  check("Submit moves the supplier to PENDING", submit.status === 200 && submit.json.supplier.status === "PENDING", submit.json);
  check("Submitting twice → 409", (await sup.post("/api/v1/supplier/submit")).status === 409);
  const lock = await sup.patch("/api/v1/supplier/profile", { legalNameEn: "Renamed After Submit", contactName: "New Contact" });
  const after = await db.supplier.findUnique({ where: { id: supplierId } });
  check("After submit: legal fields locked, contact details editable", lock.status === 200 && after?.legalNameEn === "Sahab Water Co." && after?.contactName === "New Contact");
  check("Documents cannot be removed while the application is under review (409)",(await sup.del(`/api/v1/supplier/documents/${d1.json.document.id}`)).status === 409);

  // ───── D. Independent distributor ─────
  section("D. Independent distributor");
  const ind = new Client();
  const indMobile = newMobile();
  await login(ind, indMobile);
  await ind.patch("/api/v1/me", { name: "محمد القحطاني" });
  const indApp = { type: "INDEPENDENT", legalNameAr: "محمد القحطاني للتوزيع", registrationKind: "FREELANCE", crNumber: `FL-${rnd(7)}`, contactName: "محمد", contactMobile: indMobile, idNumber: "1000000008", vehiclePlate: "ABC 1234", driverLicenseNo: rnd(9) };
  check("Independent without ID/vehicle/licence → 422", (await ind.post("/api/v1/supplier/apply", { ...indApp, idNumber: "", vehiclePlate: "", driverLicenseNo: "" })).status === 422);
  check("Invalid ID checksum → 422", (await ind.post("/api/v1/supplier/apply", { ...indApp, idNumber: "1000000009" })).status === 422);
  const indRes = await ind.post("/api/v1/supplier/apply", indApp);
  check("Independent application created with probation for 10 deliveries", indRes.status === 200 && indRes.json.supplier.probationDeliveriesLeft === 10, indRes.json);
  check("API never returns the encrypted ID number", !JSON.stringify(indRes.json).includes("idNumberEnc") && !JSON.stringify(indRes.json).includes("1000000008"));
  const indRow = await db.supplier.findUnique({ where: { id: indRes.json.supplier.id } });
  check("ID number is stored encrypted, last 4 kept for review", !!indRow?.idNumberEnc && !indRow.idNumberEnc.includes("1000000008") && indRow.idNumberLast4 === "0008");
  const indSecret = await enrol(ind);
  const indDocsAllowed = await upload(ind, "SOURCING_INVOICE", pdf("invoice"));
  check("Independent can upload sourcing invoice", indDocsAllowed.status === 200);
  void indSecret;

  // ───── E. Admin review ─────
  section("E. Admin console API");
  await resetStaff(ADMIN_MOBILE);
  await resetStaff(OPS_MOBILE);
  const admin = new Client();
  const al = await login(admin, ADMIN_MOBILE);
  check("Super-admin login points to 2FA setup", al.next.startsWith("/2fa?setup=1"), al.next);
  check("Admin API blocked before 2FA (403 MFA_REQUIRED)", (await admin.get("/api/v1/admin/suppliers")).json?.error?.code === "MFA_REQUIRED");
  const adminSecret = await enrol(admin);
  const list = await admin.get("/api/v1/admin/suppliers?status=PENDING");
  check("Admin lists pending suppliers", list.status === 200 && list.json.suppliers.some((s: { id: string }) => s.id === supplierId));
  check("Supplier list never leaks the encrypted ID", !list.text.includes("idNumberEnc"));

  const detail = await admin.get(`/api/v1/admin/suppliers/${supplierId}`);
  check("Admin sees documents, bank account and acceptance evidence", detail.status === 200 && detail.json.documents.length >= 2 && detail.json.bankAccounts.length === 1 && detail.json.acceptances.length === 1);
  const early2 = await admin.post(`/api/v1/admin/suppliers/${supplierId}/decision`, { action: "approve" });
  check("Cannot approve while documents/bank are unverified (422 INCOMPLETE)", early2.status === 422 && early2.json.error.details.missing.length >= 2, early2.json);

  const docIds: string[] = detail.json.documents.map((d: { id: string }) => d.id);
  const rejectNoReason = await admin.post(`/api/v1/admin/suppliers/${supplierId}/documents/${docIds[0]}`, { action: "reject" });
  check("Rejecting a document needs a reason (422)", rejectNoReason.status === 422);
  for (const id of docIds) {
    const r = await admin.post(`/api/v1/admin/suppliers/${supplierId}/documents/${id}`, { action: "verify" });
    if (r.status !== 200) check("verify doc", false, r.json);
  }
  const bv = await admin.post(`/api/v1/admin/suppliers/${supplierId}/bank/${bankId}`, { action: "verify" });
  check("Admin verifies the bank account", bv.status === 200);
  const approve = await admin.post(`/api/v1/admin/suppliers/${supplierId}/decision`, { action: "approve" });
  check("Approval activates the supplier", approve.status === 200 && approve.json.supplier.status === "ACTIVE", approve.json);
  const bankRow = await db.bankAccount.findUnique({ where: { id: bankId } });
  check("The verified bank account became the ACTIVE payout account", bankRow?.status === "ACTIVE" && !!bankRow.activatedAt);
  const supNow = await sup.get("/api/v1/supplier/me");
  check("Supplier sees ACTIVE", supNow.json.supplier.status === "ACTIVE");

  const needInfo = await admin.post(`/api/v1/admin/suppliers/${indRes.json.supplier.id}/decision`, { action: "reject" });
  check("Reject/needs-info without a note → 422", needInfo.status === 422 || needInfo.status === 409, needInfo.json);
  const suspendNoNote = await admin.post(`/api/v1/admin/suppliers/${supplierId}/decision`, { action: "suspend" });
  check("Suspend without a note → 422", suspendNoNote.status === 422);
  const susp = await admin.post(`/api/v1/admin/suppliers/${supplierId}/decision`, { action: "suspend", note: "verification test" });
  check("Suspend works with a note", susp.status === 200 && susp.json.supplier.status === "SUSPENDED");
  const reinst = await admin.post(`/api/v1/admin/suppliers/${supplierId}/decision`, { action: "reinstate", note: "test over" });
  check("Reinstate restores ACTIVE", reinst.status === 200 && reinst.json.supplier.status === "ACTIVE");

  // Changing the payout account of a live supplier: 48 h cool-down + admin alert (anti payment-diversion).
  const secondIban = makeSaIban();
  const newBank = await sup.post("/api/v1/supplier/bank-accounts", { iban: secondIban, holderName: "شركة سحاب للمياه" });
  check("Live supplier can request a new payout account", newBank.status === 200 && newBank.json.bankAccount.status === "PENDING", newBank.json);
  const cooldownMs = new Date(newBank.json.bankAccount.cooldownUntil).getTime() - Date.now();
  check("It carries a ~48 h cool-down", cooldownMs > 47 * 3_600_000 && cooldownMs <= 48 * 3_600_000 + 60_000, cooldownMs);
  check("Admins were alerted about the change", (await db.notification.count({ where: { event: "supplier.bank_account_changed", createdAt: { gte: new Date(Date.now() - 60_000) } } })) > 0);
  const nb = newBank.json.bankAccount.id as string;
  check("Admin verifies it", (await admin.post(`/api/v1/admin/suppliers/${supplierId}/bank/${nb}`, { action: "verify" })).status === 200);
  await sup.get("/api/v1/supplier/me");
  check("…but the OLD account stays ACTIVE while the cool-down runs",
    (await db.bankAccount.findUnique({ where: { id: bankId } }))?.status === "ACTIVE" && (await db.bankAccount.findUnique({ where: { id: nb } }))?.status === "PENDING");
  await db.bankAccount.update({ where: { id: nb }, data: { cooldownUntil: new Date(Date.now() - 1000) } });
  await sup.get("/api/v1/supplier/me");
  check("After the cool-down the new account becomes ACTIVE and the old one is REPLACED",
    (await db.bankAccount.findUnique({ where: { id: nb } }))?.status === "ACTIVE" && (await db.bankAccount.findUnique({ where: { id: bankId } }))?.status === "REPLACED");

  // ───── F. Brand Registry ─────
  section("F. Brand Registry");
  const ref = `TST-${rnd(6)}`;
  check("Buyer cannot add brands (403)", (await buyer.post("/api/v1/admin/brands", { nameAr: "علامة", nameEn: "Brand", sfdaRef: ref })).status === 403);
  const brand = await admin.post("/api/v1/admin/brands", { nameAr: "علامة تجريبية", nameEn: "Test Brand", sfdaRef: ref });
  check("Admin adds a brand (SFDA ref upper-cased)", brand.status === 200 && brand.json.brand.sfdaRef === ref.toUpperCase(), brand.json);
  check("Duplicate SFDA reference → 409", (await admin.post("/api/v1/admin/brands", { nameAr: "علامة أخرى", nameEn: "Other", sfdaRef: ref })).status === 409);
  check("Brand name must contain Arabic → 422", (await admin.post("/api/v1/admin/brands", { nameAr: "English only", nameEn: "X", sfdaRef: `TST-${rnd(6)}` })).status === 422);
  const frozen = await admin.req("PATCH", `/api/v1/admin/brands/${brand.json.brand.id}`, { body: { status: "SUSPENDED" } });
  check("Admin can freeze a brand", frozen.status === 200 && frozen.json.brand.status === "SUSPENDED");

  // ───── G. Roles, terms, users ─────
  section("G. Roles, agreements admin, users");
  const ops = new Client();
  await db.user.upsert({ where: { mobile: OPS_MOBILE }, update: {}, create: { mobile: OPS_MOBILE, name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] } });
  await login(ops, OPS_MOBILE);
  const opsSecret = await enrol(ops);
  check("Ops admin can read suppliers", (await ops.get("/api/v1/admin/suppliers")).status === 200);
  check("Ops admin cannot manage users (403)", (await ops.get("/api/v1/admin/users")).status === 403);
  check("Ops admin cannot publish agreements (403)", (await ops.post("/api/v1/admin/terms", {})).status === 403);
  check("Ops admin can read the audit log", (await ops.get("/api/v1/admin/audit?limit=5")).status === 200);
  const fees = await ops.get("/api/v1/admin/fees");
  check("Fee rule: SAR 0.50 (50 halalas) per packet is in force", fees.status === 200 && fees.json.rules.some((r: { scope: string; amountHalalas: number; model: string }) => r.scope === "GLOBAL" && r.amountHalalas === 50 && r.model === "FIXED_PER_PACKET"));

  const shortNotice = await admin.post("/api/v1/admin/terms", {
    type: "BUYER_TERMS", version: "9.1", titleAr: "عنوان", titleEn: "Title",
    bodyAr: "ن".repeat(120), bodyEn: "x".repeat(120), noticeDays: 30, effectiveFrom: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  check("Publishing a version with less than 30 days' notice is refused (422)", shortNotice.status === 422, shortNotice.json);
  if (process.env.VERIFY_PUBLISH === "1") {
    const v = `1.${Math.floor(Date.now() / 1000) % 1_000_000}`;
    const pub = await admin.post("/api/v1/admin/terms", { type: "BUYER_TERMS", version: v, titleAr: "شروط", titleEn: "Terms", bodyAr: "ن".repeat(120), bodyEn: "x".repeat(120), noticeDays: 30, effectiveFrom: new Date(Date.now() + 31 * 86_400_000).toISOString() });
    check("Publishing with proper notice works (opt-in test)", pub.status === 200, pub.json);
  }

  const newMob = newMobile();
  const staff = await admin.post("/api/v1/admin/users", { mobile: newMob, name: "Support Person", roles: ["ADMIN_SUPPORT"] });
  check("Super-admin can add a support user", staff.status === 200 && staff.json.user.roles.includes("ADMIN_SUPPORT"));
  const onlySuper = await db.user.findMany({ where: { roles: { has: "SUPER_ADMIN" }, status: "ACTIVE" } });
  if (onlySuper.length === 1) {
    const self = await admin.post(`/api/v1/admin/users/${onlySuper[0].id}/roles`, { roles: ["ADMIN_OPS"] });
    check("The last super-admin cannot be demoted (409)", self.status === 409, self.json);
  } else {
    check("(skipped: more than one super-admin exists)", true);
  }

  // ───── H. Database-level guarantees ─────
  section("H. Database guarantees (append-only, immutable)");
  const attempt = async (fn: () => Promise<unknown>) => fn().then(() => false, () => true);
  check("Audit log rows cannot be updated", await attempt(() => db.auditLog.updateMany({ data: { note: "tamper" } })));
  check("Audit log rows cannot be deleted", await attempt(() => db.auditLog.deleteMany({})));
  check("Acceptance records cannot be updated", await attempt(() => db.termsAcceptance.updateMany({ data: { signatoryName: "tamper" } })));
  check("Acceptance records cannot be deleted", await attempt(() => db.termsAcceptance.deleteMany({})));
  check("Published agreement text cannot be edited", await attempt(() => db.termsDocument.updateMany({ data: { bodyEn: "tampered" } })));
  check("Published agreements cannot be deleted", await attempt(() => db.termsDocument.deleteMany({})));
  check("Two ACTIVE bank accounts for one supplier are impossible", await attempt(() => db.bankAccount.create({ data: { supplierId, iban: makeSaIban(), holderName: "x", status: "ACTIVE" } })));
  check("Non-Saudi mobile numbers cannot be stored", await attempt(() => db.user.create({ data: { mobile: "+971501234567" } })));

  // ───── I. TOTP replay + sessions ─────
  section("I. Two-step replay protection and sign-out");
  const freshLogin = async (c: Client, mobile = ADMIN_MOBILE) => {
    await db.otpChallenge.deleteMany({ where: { mobile } }); // skip the 60 s resend cool-down in tests
    await login(c, mobile);
  };
  const again2 = new Client();
  await freshLogin(again2);
  check("Fresh admin session is blocked until 2FA (MFA_REQUIRED)", (await again2.get("/api/v1/admin/suppliers")).json?.error?.code === "MFA_REQUIRED");
  // Use a code from the NEXT 30 s window: valid (window ±1) and newer than the one used at enrolment.
  const codeOnce = totpFor(adminSecret, Date.now() + 30_000);
  const first2 = await again2.post("/api/v1/auth/2fa/verify", { token: codeOnce });
  check("A fresh authenticator code is accepted", first2.status === 200, first2.json);
  check("…and unlocks the admin API", (await again2.get("/api/v1/admin/suppliers")).status === 200);

  const again3 = new Client();
  await freshLogin(again3);
  const replay = await again3.post("/api/v1/auth/2fa/verify", { token: codeOnce });
  check("Replaying the same code from another session is refused (TOTP_INVALID)", replay.status === 400 && replay.json.error.code === "TOTP_INVALID", replay.json);
  // Brute-force protection is exercised on the ops account so the super-admin is not locked out afterwards.
  const opsAttacker = new Client();
  await freshLogin(opsAttacker, OPS_MOBILE);
  const wrongTok = totpFor(opsSecret) === "123456" ? "654321" : "123456";
  let limited: Res | null = null;
  for (let i = 0; i < 6; i++) limited = await opsAttacker.post("/api/v1/auth/2fa/verify", { token: wrongTok });
  check("Repeated wrong authenticator codes are rate-limited (429)", limited!.status === 429, limited!.status);

  const out = await again2.post("/api/v1/auth/logout");
  check("Sign-out revokes the session", out.status === 200 && (await again2.get("/api/v1/me")).status === 401);

  // ───── J. Audit trail ─────
  section("J. Audit trail");
  const actions = new Set((await db.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, select: { action: true } })).map((a) => a.action));
  for (const a of ["terms.accepted", "supplier.applied", "supplier.submitted", "supplier.approve", "supplier.document_verified", "supplier.bank_account_verified", "brand.created", "auth.totp_enabled", "user.staff_granted"]) {
    check(`Audit has '${a}'`, actions.has(a));
  }
  check("Admin was notified of the submission (in-app)", (await db.notification.count({ where: { event: "supplier.submitted", channel: "IN_APP", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } })) > 0);
  check("The SMS log never stores one-time codes",
    (await db.notification.findMany({ where: { event: { startsWith: "otp." } }, take: 200 })).every((n) => !/\d{6}/.test(JSON.stringify(n.payload))));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("\nverify crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
