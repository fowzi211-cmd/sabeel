import Link from "next/link";
import { Banner, Card, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";

export default async function Home() {
  const { t } = await getI18n();
  const steps = ["home.step1", "home.step2", "home.step3", "home.step4"];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card tint className="!p-6 sm:!p-10">
        <h1 className="text-3xl font-bold leading-tight text-aqua-700 sm:text-4xl">{t("home.heroTitle")}</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">{t("home.heroText")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/order" className={btnCls("primary")}>
            {t("order.typeDonation")}
          </Link>
          <Link href="/order?type=self" className={btnCls("secondary")}>
            {t("order.typeSelf")}
          </Link>
          <Link href="/supplier/apply" className={btnCls("ghost")}>
            {t("home.ctaSupplier")}
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted">{t("home.ctaSupplierNote")}</p>
      </Card>

      <Card>
        <h2 className="mb-4 text-xl font-bold">{t("home.howTitle")}</h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          {steps.map((k, i) => (
            <li key={k} className="flex items-center gap-3 rounded-xl bg-page p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-aqua-600 font-bold text-white">{i + 1}</span>
              <span>{t(k)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Banner tone="info">
        {t("home.pilotNote")}
      </Banner>
    </div>
  );
}
