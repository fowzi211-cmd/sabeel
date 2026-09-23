/**
 * Idempotent seed.
 *   npm run db:seed            → super-admin, agreement drafts v1.0, global fee rule
 *   npm run db:seed -- --demo  → also demo brands (fictional) and demo staff, dev only
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { SEED_TERMS } from "./seed-data/terms";

const db = new PrismaClient();
const demo = process.argv.includes("--demo");

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const hash = (s: string) => createHash("sha256").update(norm(s)).digest("hex");

/**
 * Three FICTIONAL, already-approved suppliers so the comparison and ordering screens have data in
 * development. They bypass onboarding (no agreement evidence), so they must never exist in production.
 * Sign in as their owners (+966500000101…103) — the sign-in code is shown on screen in development.
 */
async function seedDemoSuppliers(adminId: string) {
  const DEMO_IBAN = "SA0380000000608010167519";
  const brand = async (ref: string) => (await db.brand.findUniqueOrThrow({ where: { sfdaRef: ref } })).id;
  // brands must exist first
  for (const b of [
    { nameAr: "نوفا", nameEn: "Nova", sfdaRef: "DEMO-0001" },
    { nameAr: "عين بيور", nameEn: "Ain Pure", sfdaRef: "DEMO-0002" },
    { nameAr: "واحة", nameEn: "Waha", sfdaRef: "DEMO-0003" },
  ]) {
    await db.brand.upsert({ where: { sfdaRef: b.sfdaRef }, update: {}, create: { ...b, notes: "DEMO brand — fictional, for development only", createdById: adminId } });
  }
  const dist = async (slug: string) => (await db.district.findUniqueOrThrow({ where: { slug } })).id;

  const suppliers = [
    {
      mobile: "+966500000101", ownerName: "Demo Sahab Owner", type: "BRAND_COMPANY" as const, kind: "CR" as const, cr: "9990000001", vat: "399999999999993",
      nameAr: "شركة سحاب للمياه (تجريبي)", nameEn: "Sahab Water Co. (DEMO)",
      offers: [["DEMO-0001", 500, 20, 900, 5], ["DEMO-0002", 330, 20, 850, 5], ["DEMO-0003", 500, 20, 920, 5]] as [string, number, number, number, number][],
      zones: [["al-aziziyah", 2000, 24], ["al-shawqiyyah", 2500, 24], ["al-awali", 3000, 48]] as [string, number, number][],
    },
    {
      mobile: "+966500000102", ownerName: "Demo Tayseer Owner", type: "BRAND_COMPANY" as const, kind: "CR" as const, cr: "9990000002", vat: "399999999999993",
      nameAr: "مؤسسة تيسير للتوزيع (تجريبي)", nameEn: "Tayseer Distribution (DEMO)",
      offers: [["DEMO-0003", 500, 20, 850, 10], ["DEMO-0001", 500, 20, 920, 1]] as [string, number, number, number, number][],
      zones: [["al-aziziyah", 1500, 24], ["al-naseem", 2500, 24]] as [string, number, number][],
    },
    {
      mobile: "+966500000103", ownerName: "Demo Mohammed", type: "INDEPENDENT" as const, kind: "FREELANCE" as const, cr: "FL-9990003", vat: null,
      nameAr: "محمد للتوزيع (تجريبي)", nameEn: "Mohammed Distribution (DEMO)",
      offers: [["DEMO-0002", 330, 20, 900, 1], ["DEMO-0001", 500, 24, 1050, 1]] as [string, number, number, number, number][],
      zones: [["al-aziziyah", 1000, 48], ["al-rusayfah", 1500, 48]] as [string, number, number][],
    },
  ];

  for (const s of suppliers) {
    const owner = await db.user.upsert({
      where: { mobile: s.mobile },
      update: {},
      create: { mobile: s.mobile, name: s.ownerName, roles: ["BUYER", "SUPPLIER_ADMIN"], language: "AR" },
    });
    let sup = await db.supplier.findUnique({ where: { crNumber: s.cr } });
    if (!sup) {
      sup = await db.supplier.create({
        data: {
          type: s.type, status: "ACTIVE", legalNameAr: s.nameAr, legalNameEn: s.nameEn, registrationKind: s.kind, crNumber: s.cr,
          vatNumber: s.vat, contactName: s.ownerName, contactMobile: s.mobile, creditCeilingHalalas: 25_000, invoiceCycle: "WEEKLY",
          ...(s.type === "INDEPENDENT" ? { probationDeliveriesLeft: 10, idNumberLast4: "0008", vehiclePlate: "DEMO 1234", driverLicenseNo: "0000000" } : {}),
          decidedAt: new Date(), decidedById: adminId, decisionNote: "DEMO supplier — created by the development seed",
          members: { create: { userId: owner.id, role: "OWNER" } },
          bankAccounts: { create: { iban: DEMO_IBAN, holderName: s.nameAr, status: "ACTIVE", activatedAt: new Date(), reviewedAt: new Date() } },
        },
      });
    }
    for (const [ref, ml, pack, price, min] of s.offers) {
      await db.offer.upsert({
        where: { supplierId_brandId_bottleMl_bottlesPerPack: { supplierId: sup.id, brandId: await brand(ref), bottleMl: ml, bottlesPerPack: pack } },
        update: {},
        create: { supplierId: sup.id, brandId: await brand(ref), bottleMl: ml, bottlesPerPack: pack, packetEqMilli: pack * 50, priceHalalas: price, minQtyPacks: min },
      });
    }
    for (const [slug, fee, lead] of s.zones) {
      await db.coverageZone.upsert({
        where: { supplierId_districtId: { supplierId: sup.id, districtId: await dist(slug) } },
        update: {},
        create: { supplierId: sup.id, districtId: await dist(slug), deliveryFeeHalalas: fee, leadTimeHours: lead },
      });
    }
  }
  console.log("demo: 3 fictional ACTIVE suppliers with offers and zones (owners +966500000101…103)");
}

async function main() {
  if (process.env.NODE_ENV === "production" && demo) {
    throw new Error("Refusing to seed demo data in production.");
  }

  const mobile = process.env.SEED_SUPERADMIN_MOBILE;
  if (!mobile || !/^\+9665\d{8}$/.test(mobile)) {
    throw new Error("Set SEED_SUPERADMIN_MOBILE to a valid Saudi mobile (+9665XXXXXXXX) in .env");
  }
  if (process.env.NODE_ENV === "production" && mobile === "+966500000001") {
    throw new Error("Change SEED_SUPERADMIN_MOBILE from the development placeholder before seeding production.");
  }

  const admin = await db.user.upsert({
    where: { mobile },
    update: {},
    create: {
      mobile,
      name: process.env.SEED_SUPERADMIN_NAME ?? "Sabeel Super Admin",
      roles: ["BUYER", "SUPER_ADMIN"],
      language: "AR",
    },
  });
  console.log(`super-admin: ${admin.mobile} (${admin.id})`);

  for (const t of SEED_TERMS) {
    const existing = await db.termsDocument.findUnique({ where: { type_version: { type: t.type, version: t.version } } });
    if (existing) continue;
    await db.termsDocument.create({
      data: {
        type: t.type,
        version: t.version,
        titleAr: t.titleAr,
        titleEn: t.titleEn,
        bodyAr: norm(t.bodyAr),
        bodyEn: norm(t.bodyEn),
        sha256Ar: hash(t.bodyAr),
        sha256En: hash(t.bodyEn),
        noticeDays: 30,
        effectiveFrom: new Date(),
        publishedById: admin.id,
      },
    });
    console.log(`terms: ${t.type} v${t.version} (draft — awaiting legal review)`);
  }

  const hasGlobalFee = await db.feeRule.findFirst({ where: { scope: "GLOBAL" } });
  if (!hasGlobalFee) {
    await db.feeRule.create({
      data: {
        scope: "GLOBAL",
        model: "FIXED_PER_PACKET",
        amountHalalas: 50, // SAR 0.50 per packet (20 bottles)
        effectiveFrom: new Date(),
        reason: "Launch fee decided by the owner",
        createdById: admin.id,
      },
    });
    console.log("fee: GLOBAL 50 halalas per packet");
  }

  // Makkah delivery districts. The neighbourhood list is a starting point — confirm the real coverage with
  // the pilot suppliers. The two restricted areas are excluded from the pilot (lean prompt §9).
  const districts = [
    { slug: "al-aziziyah", nameAr: "العزيزية", nameEn: "Al-Aziziyah" },
    { slug: "al-shawqiyyah", nameAr: "الشوقية", nameEn: "Al-Shawqiyyah" },
    { slug: "al-awali", nameAr: "العوالي", nameEn: "Al-Awali" },
    { slug: "al-rusayfah", nameAr: "الرصيفة", nameEn: "Al-Rusayfah" },
    { slug: "al-naseem", nameAr: "النسيم", nameEn: "Al-Naseem" },
    { slug: "al-zahir", nameAr: "الزاهر", nameEn: "Al-Zahir" },
    { slug: "kudai", nameAr: "كدي", nameEn: "Kudai" },
    { slug: "al-nuzha", nameAr: "النزهة", nameEn: "Al-Nuzha" },
    { slug: "al-sharaya", nameAr: "الشرائع", nameEn: "Al-Sharaya" },
    { slug: "al-kakiyyah", nameAr: "الكعكية", nameEn: "Al-Kakiyyah" },
  ].map((d, i) => ({ ...d, restricted: false, sortOrder: i + 1 }));
  const restricted = [
    { slug: "haram-central", nameAr: "المنطقة المركزية (الحرم وما حوله)", nameEn: "Central Haram area", restricted: true, restrictedReason: "دخول مقيّد — مستبعدة من المرحلة التجريبية حتى تُعتمد مع الجهات المختصة", restrictedReasonEn: "Restricted access — excluded from the pilot until cleared with the authorities", sortOrder: 900 },
    { slug: "holy-sites", nameAr: "المشاعر المقدسة (منى وعرفات ومزدلفة)", nameEn: "Holy sites (Mina, Arafat, Muzdalifah)", restricted: true, restrictedReason: "قيود موسم الحج — مستبعدة من المرحلة التجريبية", restrictedReasonEn: "Hajj-season restrictions — excluded from the pilot", sortOrder: 901 },
  ];
  for (const d of [...districts, ...restricted]) {
    await db.district.upsert({ where: { slug: d.slug }, update: {}, create: { city: "Makkah", ...d } });
  }
  console.log(`districts: ${districts.length} serviceable + ${restricted.length} restricted (Makkah)`);

  if (demo) {
    await seedDemoSuppliers(admin.id);
    const brands = [
      { nameAr: "نوفا", nameEn: "Nova", sfdaRef: "DEMO-0001" },
      { nameAr: "عين بيور", nameEn: "Ain Pure", sfdaRef: "DEMO-0002" },
      { nameAr: "واحة", nameEn: "Waha", sfdaRef: "DEMO-0003" },
    ];
    for (const b of brands) {
      await db.brand.upsert({
        where: { sfdaRef: b.sfdaRef },
        update: {},
        create: { ...b, notes: "DEMO brand — fictional, for development only", createdById: admin.id },
      });
    }
    const staff = [
      { mobile: "+966500000002", name: "Ops Reviewer", roles: ["BUYER", "ADMIN_OPS"] as const },
      { mobile: "+966500000003", name: "Finance Reviewer", roles: ["BUYER", "ADMIN_FINANCE"] as const },
    ];
    for (const s of staff) {
      await db.user.upsert({
        where: { mobile: s.mobile },
        update: {},
        create: { mobile: s.mobile, name: s.name, roles: [...s.roles], language: "AR" },
      });
    }
    console.log("demo: 3 fictional brands, 2 demo staff users");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
