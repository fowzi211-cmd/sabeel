import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMeta } from "@/i18n/meta";
import { SupplierReview } from "@/components/SupplierReview";
import { Card, Chip, PageHeading, fmtDate, statusTone } from "@/components/ui";
import { getI18n } from "@/i18n";
import { requirePage } from "@/lib/guards";
import { hasRole } from "@/lib/session";
import { buildChecklist, getSupplierForAdmin } from "@/server/suppliers";

export const generateMetadata = pageMeta("admin.detailTitle");

export default async function AdminSupplierDetail({ params }: PageProps<"/admin/suppliers/[id]">) {
  const { id } = await params;
  const { user } = await requirePage({ path: `/admin/suppliers/${id}`, roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] });
  const { t, locale } = await getI18n();

  const s = await getSupplierForAdmin(id);
  if (!s) notFound();
  const owner = s.members.find((m) => m.role === "OWNER");
  const checklist = owner ? await buildChecklist(s, owner.userId) : null;
  // The full ID number is never rendered anywhere; admins only see its last four digits.
  const canDecide = hasRole(user.roles, "ADMIN_OPS");
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[180px_1fr]"><dt className="text-sm text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>
  );

  return (
    <div className="space-y-5">
      <PageHeading
        title={s.legalNameAr}
        sub={t("admin.detailTitle")}
        actions={<Chip tone={statusTone(s.status)}>{t(`supplier.status.${s.status}`)}</Chip>}
      />

      <Card>
        <dl>
          {row(t("admin.type"), s.type === "INDEPENDENT" ? t("supplier.typeIndependent") : t("supplier.typeBrand"))}
          {s.legalNameEn ? row(t("supplier.legalNameEn"), s.legalNameEn) : null}
          {row(s.registrationKind === "FREELANCE" ? t("supplier.freelanceNumber") : t("supplier.crNumber"), <span className="ltr-iso">{s.crNumber}</span>)}
          {s.vatNumber ? row(t("supplier.vatNumber"), <span className="ltr-iso">{s.vatNumber}</span>) : null}
          {row(t("admin.contact"), <>{s.contactName} · <span className="ltr-iso">{s.contactMobile}</span>{s.contactEmail ? <> · <span className="ltr-iso">{s.contactEmail}</span></> : null}</>)}
          {s.idNumberLast4 ? row(t("supplier.idNumber"), t("admin.idLast4", { v: s.idNumberLast4 })) : null}
          {s.vehiclePlate ? row(t("supplier.vehiclePlate"), s.vehiclePlate) : null}
          {s.driverLicenseNo ? row(t("supplier.driverLicenseNo"), <span className="ltr-iso">{s.driverLicenseNo}</span>) : null}
          {s.submittedAt ? row(t("admin.submittedAt"), fmtDate(s.submittedAt, locale, true)) : null}
          {s.decisionNote ? row(t("supplier.adminNote"), s.decisionNote) : null}
          {row(t("admin.members"), s.members.map((m) => `${m.user.name ?? "—"} (${m.user.mobile})`).join("، "))}
        </dl>
      </Card>

      {checklist ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t("admin.checklist")}</h2>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {checklist.docs.filter((d) => d.required).map((d) => (
              <li key={d.kind} className="flex items-center gap-2"><Chip tone={d.verified ? "ok" : d.satisfied ? "warn" : "bad"}>{d.verified ? "✔" : d.satisfied ? "…" : "✖"}</Chip>{t(`supplier.docKind.${d.kind}`)}</li>
            ))}
            <li className="flex items-center gap-2"><Chip tone={checklist.bank.verified ? "ok" : checklist.bank.present ? "warn" : "bad"}>{checklist.bank.verified ? "✔" : checklist.bank.present ? "…" : "✖"}</Chip>{t("supplier.steps.bank")}</li>
            <li className="flex items-center gap-2"><Chip tone={checklist.agreement.accepted ? "ok" : "bad"}>{checklist.agreement.accepted ? "✔" : "✖"}</Chip>{t("supplier.steps.agreement")}{checklist.agreement.version ? ` v${checklist.agreement.version}` : ""}{!checklist.agreement.legalReviewed ? <span className="text-xs text-warn"> · {t("common.draftBadge")}</span> : null}</li>
          </ul>
        </Card>
      ) : null}

      <SupplierReview
        supplierId={s.id}
        status={s.status}
        canDecide={canDecide}
        approveBlockers={checklist && !checklist.approveReady ? checklist.blockers : []}
        docs={s.documents.map((d) => ({ id: d.id, kind: d.kind, originalName: d.originalName, status: d.status, number: d.number, expiresAt: d.expiresAt?.toISOString() ?? null, rejectReason: d.rejectReason, sha256: d.sha256 }))}
        banks={s.bankAccounts.map((b) => ({ id: b.id, iban: b.iban, holderName: b.holderName, bankName: b.bankName, status: b.status, reviewedAt: b.reviewedAt?.toISOString() ?? null, cooldownUntil: b.cooldownUntil?.toISOString() ?? null, rejectReason: b.rejectReason }))}
      />

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t("admin.agreements")}</h2>
        {s.acceptances.length === 0 ? <p className="text-muted">{t("common.none")}</p> : (
          <ul className="divide-y divide-line text-sm">
            {s.acceptances.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{t(`admin.termsType.${a.termsType}`)} · v{a.version} · {a.signatoryName}</span>
                <Link className="font-semibold text-aqua-700 underline" href={`/certificate/${a.certificateNo}`}><span className="ltr-iso">{a.certificateNo}</span></Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
