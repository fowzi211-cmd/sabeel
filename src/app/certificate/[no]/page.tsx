import { notFound } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { PrintButton } from "@/components/PrintButton";
import { Card, PageHeading, fmtDate } from "@/components/ui";
import { getI18n } from "@/i18n";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";

export const generateMetadata = pageMeta("certificate.title");

/** Printable evidence of an online acceptance. Visible to the signatory, the supplier's owners and staff. */
export default async function CertificatePage({ params }: PageProps<"/certificate/[no]">) {
  const { no } = await params;
  const { user } = await requirePage({ path: `/certificate/${no}` });
  const { t, locale } = await getI18n();

  const a = await db.termsAcceptance.findUnique({
    where: { certificateNo: no },
    include: { termsDocument: true, supplier: { include: { members: true } }, user: { select: { name: true, mobile: true } } },
  });
  if (!a) notFound();

  const isStaff = hasRole(user.roles, "ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE");
  const isOwner = a.userId === user.id || !!a.supplier?.members.some((m) => m.userId === user.id);
  if (!isStaff && !isOwner) notFound(); // do not reveal that the certificate exists

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 border-t border-line py-2.5 sm:grid-cols-[220px_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeading title={t("certificate.title")} actions={<PrintButton />} />
      <Card>
        <p className="mb-2 text-sm text-muted">{t("certificate.note")}</p>
        <dl>
          {row(t("certificate.number"), <span className="ltr-iso font-mono">{a.certificateNo}</span>)}
          {row(t("certificate.signatory"), `${a.signatoryName} · ${a.user.mobile}`)}
          {a.supplier ? row(t("certificate.company"), `${a.supplier.legalNameAr} · CR ${a.supplier.crNumber}`) : null}
          {row(t("certificate.document"), locale === "ar" ? a.termsDocument.titleAr : a.termsDocument.titleEn)}
          {row(t("certificate.version"), a.version)}
          {row(t("certificate.acceptedAt"), `${fmtDate(a.acceptedAt, locale, true)} (Asia/Riyadh) · ${a.acceptedAt.toISOString()}`)}
          {row(t("certificate.method"), a.method === "CLICK_WRAP_OTP" ? t("certificate.methodOtp") : t("certificate.methodSession"))}
          {a.authorisedToBind ? row(t("certificate.authorised"), t("common.yes")) : null}
          {row(t("certificate.ip"), <span className="ltr-iso font-mono">{a.ip ?? "—"}</span>)}
          {row(t("certificate.device"), <span className="ltr-iso break-all font-mono text-xs">{a.userAgent ?? "—"}</span>)}
          {row(t("certificate.hashAr"), <span className="ltr-iso break-all font-mono text-xs">{a.sha256Ar}</span>)}
          {row(t("certificate.hashEn"), <span className="ltr-iso break-all font-mono text-xs">{a.sha256En}</span>)}
        </dl>
      </Card>
    </div>
  );
}
