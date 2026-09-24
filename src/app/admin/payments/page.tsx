import { Card, PageHeading, Table, td, th } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { requirePage } from "@/lib/guards";
import { formatSar } from "@/lib/money";
import { allPaymentTotals } from "@/server/payments";

export const generateMetadata = pageMeta("adminPayments.title");

export default async function AdminPaymentsPage() {
  await requirePage({ path: "/admin/payments", roles: ["ADMIN_OPS", "ADMIN_FINANCE"] });
  const { t, locale } = await getI18n();
  const { overall, suppliers } = await allPaymentTotals();
  const money = (h: number) => formatSar(h, locale);
  const stat = (label: string, value: string) => (
    <div className="flex justify-between border-t border-line py-2"><dt className="text-sm text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>
  );

  return (
    <div className="space-y-4">
      <PageHeading title={t("adminPayments.title")} sub={t("adminPayments.intro")} />
      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("adminPayments.overall")}</h2>
        <dl className="grid gap-x-6 sm:grid-cols-2">
          {stat(t("adminPayments.payments"), String(overall.count))}
          {stat(t("adminPayments.received"), `${overall.received.count} · ${money(overall.received.halalas)}`)}
          {stat(t("adminPayments.fees"), money(overall.received.feeHalalas + overall.received.feeVatHalalas))}
          {stat(t("adminPayments.kept"), money(overall.received.keptHalalas))}
        </dl>
      </Card>
      {suppliers.length === 0 ? <Card><p className="text-muted">{t("payments.empty")}</p></Card> : (
        <Table>
          <thead>
            <tr>
              <th className={th}>{t("adminPayments.col.supplier")}</th>
              <th className={th}>{t("adminPayments.payments")}</th>
              <th className={th}>{t("adminPayments.received")}</th>
              <th className={th}>{t("adminPayments.fees")}</th>
              <th className={th}>{t("adminPayments.kept")}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.supplierId}>
                <td className={td}>{(locale === "ar" ? s.supplier?.legalNameAr : s.supplier?.tradeName || s.supplier?.legalNameEn) ?? "—"}</td>
                <td className={td}>{s.totals.count}</td>
                <td className={td}>{s.totals.received.count} · {money(s.totals.received.halalas)}</td>
                <td className={td}>{money(s.totals.received.feeHalalas + s.totals.received.feeVatHalalas)}</td>
                <td className={td}>{money(s.totals.received.keptHalalas)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
