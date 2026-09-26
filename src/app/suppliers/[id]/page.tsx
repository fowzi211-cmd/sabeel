import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Chip, PageHeading, btnCls } from "@/components/ui";
import { getI18n } from "@/i18n";
import { pageMeta } from "@/i18n/meta";
import { fmtWhen } from "@/lib/format";
import { REVIEW_CATEGORIES } from "@/lib/fulfilment";
import { requirePage } from "@/lib/guards";
import { getPublicSupplierProfile, listPublicSupplierReviews } from "@/server/profile";

export const generateMetadata = pageMeta("profile.title");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const Stars = ({ n }: { n: number }) => <span className="text-warn" aria-hidden>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;

export default async function SupplierProfile({ params, searchParams }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  await requirePage({ path: `/suppliers/${id}` });
  const { t, locale } = await getI18n();
  const cursor = one((await searchParams).cursor);
  const profile = await getPublicSupplierProfile(id);
  if (!profile) notFound();
  const { items: reviews, nextCursor } = await listPublicSupplierReviews(id, { cursor });
  const num = (n: number) => n.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US");
  const pct = (v: number | null, n: number) => (v === null ? { value: "—", note: t("profile.notEnough", { n: 5 - Math.min(n, 4) }) } : { value: `${num(v)}%`, note: t("profile.basedOn", { n }) });

  const stats = [
    { key: "onTime", ...pct(profile.onTimePct, profile.onTimeCount) },
    { key: "acceptance", ...pct(profile.acceptancePct, profile.acceptanceCount) },
    { key: "dispute", ...pct(profile.disputePct, profile.disputeCount) },
  ];

  return (
    <div className="space-y-4">
      <PageHeading title={locale === "ar" ? profile.nameAr : profile.nameEn} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="ok">✔ {t("order.verified")}</Chip>
        {profile.independent ? <Chip tone="neutral">🚚 {t("order.independent")}</Chip> : null}
        {profile.rating !== null ? <Chip tone="neutral">★ {num(profile.rating)} <span className="text-muted">({profile.reviewCount})</span></Chip> : <Chip tone="neutral">☆ {t("order.isNew")} <span className="text-muted">({profile.reviewCount})</span></Chip>}
        <span className="text-xs text-muted">{t("profile.since", { date: fmtWhen(profile.memberSince, locale) })}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.key}>
            <div className="text-xs text-muted">{t(`profile.stat.${s.key}`)}</div>
            <div className="mt-1 text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-muted">{s.note}</div>
          </Card>
        ))}
      </div>

      {profile.rating !== null ? (
        <Card>
          <h2 className="mb-2 text-lg font-bold">{t("profile.categories")}</h2>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {REVIEW_CATEGORIES.map((c) => (
              <div key={c} className="flex justify-between border-t border-line py-2">
                <dt className="text-sm text-muted">{t(`review.categories.${c}`)}</dt>
                <dd className="font-semibold">{profile.categories[c] === null ? "—" : `★ ${num(profile.categories[c] as number)}`}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      <h2 className="text-lg font-bold">{t("profile.reviews")}</h2>
      {reviews.length === 0 ? <Card><p className="text-muted">{t("supplierReviews.empty")}</p></Card> : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><Stars n={r.stars} /> <span className="ms-2 text-sm text-muted">{r.buyerFirstName ?? t("profile.anonymous")}</span></div>
                <span className="text-xs text-muted">{fmtWhen(r.createdAt, locale)}</span>
              </div>
              {r.comment ? <p className="mt-2 text-sm">{r.comment}</p> : null}
              {r.reply ? (
                <div className="mt-3 rounded-[10px] border border-line bg-page p-3">
                  <h3 className="text-sm font-semibold">{t("review.supplierReply")}</h3>
                  <p className="mt-1 text-sm">{r.reply.text}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      {nextCursor ? <Link href={`/suppliers/${id}?cursor=${nextCursor}`} className={btnCls("secondary")}>{t("common.older")}</Link> : null}
    </div>
  );
}
