import Link from "next/link";
import { redirect } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { BankPanel, type BankView } from "@/components/BankPanel";
import { ContactForm } from "@/components/ContactForm";
import { DocumentsPanel, type DocSlotView } from "@/components/DocumentsPanel";
import { SubmitPanel } from "@/components/SubmitPanel";
import { Banner, Card, Chip, PageHeading, btnCls, fmtDate, statusTone } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { buildChecklist, ensureBankActivation, getOwnedSupplier } from "@/server/suppliers";
import { db } from "@/lib/db";

export const generateMetadata = pageMeta("supplier.title");

const EDIT_ALL = ["DRAFT", "NEEDS_INFO"];
const EDIT_LIVE = ["ACTIVE", "PAUSED"];

export default async function SupplierPortal() {
  const { user } = await requirePage({ path: "/supplier", roles: ["SUPPLIER_ADMIN"] });
  const { t, locale } = await getI18n();

  let supplier = await getOwnedSupplier(user.id);
  if (!supplier) redirect("/supplier/apply");
  await ensureBankActivation(supplier.id);
  supplier = (await getOwnedSupplier(user.id))!;

  const checklist = await buildChecklist(supplier, user.id);
  const acceptance = await db.termsAcceptance.findFirst({
    where: { supplierId: supplier.id, termsType: checklist.agreement.type, version: checklist.agreement.version ?? undefined },
    orderBy: { acceptedAt: "desc" },
  });

  const editAll = EDIT_ALL.includes(supplier.status);
  const editLive = EDIT_LIVE.includes(supplier.status);
  const name = locale === "ar" ? supplier.legalNameAr : supplier.legalNameEn || supplier.legalNameAr;

  const slots: DocSlotView[] = checklist.docs.map((d) => ({
    kind: d.kind,
    required: d.required,
    state: d.expired ? "EXPIRED" : d.latest ? (d.latest.status as DocSlotView["state"]) : "MISSING",
    latest: d.latest && {
      id: d.latest.id,
      originalName: d.latest.originalName,
      expiresAt: d.latest.expiresAt ? d.latest.expiresAt.toISOString() : null,
      rejectReason: d.latest.rejectReason,
      number: d.latest.number,
    },
  }));
  const banks: BankView[] = supplier.bankAccounts.map((b) => ({
    id: b.id, iban: b.iban, holderName: b.holderName, bankName: b.bankName, status: b.status,
    cooldownUntil: b.cooldownUntil ? b.cooldownUntil.toISOString() : null, rejectReason: b.rejectReason,
  }));

  const statusBanner = supplier.status === "ACTIVE" ? "ok" : supplier.status === "PENDING" || supplier.status === "DRAFT" ? "info" : "warn";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading
        title={name}
        sub={t("supplier.title")}
        actions={<Chip tone={statusTone(supplier.status)}>{t(`supplier.status.${supplier.status}`)}</Chip>}
      />

      <Banner tone={statusBanner}>{t(`supplier.statusHelp.${supplier.status}`)}</Banner>
      {supplier.decisionNote && ["NEEDS_INFO", "REJECTED", "SUSPENDED", "PAUSED"].includes(supplier.status) ? (
        <Banner tone="warn"><strong>{t("supplier.adminNote")}:</strong> {supplier.decisionNote}</Banner>
      ) : null}
      {supplier.type === "INDEPENDENT" && supplier.probationDeliveriesLeft > 0 ? (
        <Banner tone="info">{t("supplier.independentProbation", { n: supplier.probationDeliveriesLeft })}</Banner>
      ) : null}

      <Card>
        <h2 className="text-lg font-bold">{t("supplier.steps.company")}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">{t("supplier.legalNameAr")}</dt><dd className="font-medium">{supplier.legalNameAr}</dd></div>
          <div><dt className="text-muted">{t("supplier.type")}</dt><dd className="font-medium">{supplier.type === "INDEPENDENT" ? t("supplier.typeIndependent") : t("supplier.typeBrand")}</dd></div>
          <div><dt className="text-muted">{supplier.registrationKind === "FREELANCE" ? t("supplier.freelanceNumber") : t("supplier.crNumber")}</dt><dd className="ltr-iso font-medium">{supplier.crNumber}</dd></div>
          {supplier.vatNumber ? <div><dt className="text-muted">{t("supplier.vatNumber")}</dt><dd className="ltr-iso font-medium">{supplier.vatNumber}</dd></div> : null}
        </dl>
        <p className="mt-3 text-xs text-muted">{t("supplier.companyEditable")}</p>
        <ContactForm contactName={supplier.contactName} contactMobile={supplier.contactMobile} contactEmail={supplier.contactEmail ?? ""} />
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("supplier.steps.documents")}</h2>
        <DocumentsPanel slots={slots} canEdit={editAll || editLive} />
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("supplier.steps.bank")}</h2>
        <BankPanel accounts={banks} canEdit={editAll || editLive} hasActive={supplier.bankAccounts.some((b) => b.status === "ACTIVE")} />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{t("supplier.steps.agreement")}</h2>
          <Chip tone={checklist.agreement.accepted ? "ok" : "warn"}>
            {checklist.agreement.accepted ? t("supplier.signed") : t("supplier.notAccepted")}
          </Chip>
        </div>
        <p className="mt-1 text-muted">{t("supplier.agreementIntro")}</p>
        {acceptance ? (
          <p className="mt-2 text-sm">
            {t("supplier.agreementAccepted", { version: acceptance.version, cert: acceptance.certificateNo })}{" "}
            <span className="text-muted">({fmtDate(acceptance.acceptedAt, locale, true)})</span>
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/supplier/agreement" className={btnCls(acceptance ? "secondary" : "primary")}>{t("supplier.agreementOpen")}</Link>
          {acceptance ? <Link href={`/certificate/${acceptance.certificateNo}`} className={btnCls("ghost")}>{t("supplier.agreementView")}</Link> : null}
        </div>
      </Card>

      {editAll ? (
        <Card tint>
          <h2 className="mb-2 text-lg font-bold">{t("supplier.steps.submit")}</h2>
          <SubmitPanel ready={checklist.submitReady} blockers={checklist.blockers} />
        </Card>
      ) : null}
    </div>
  );
}
