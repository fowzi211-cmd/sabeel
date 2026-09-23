"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, btnCls, inputCls } from "./ui";

const CATEGORIES = ["timeliness", "asOrdered", "packaging", "driverConduct", "value"] as const;

export interface ReviewView {
  stars: number;
  timeliness: number | null;
  asOrdered: number | null;
  packaging: number | null;
  driverConduct: number | null;
  value: number | null;
  comment: string | null;
  createdAt: string | Date;
  photoUrl: string | null;
  removed: boolean;
  reply: { text: string; createdAt: string | Date } | null;
}

const Stars = ({ value, onChange }: { value: number; onChange?: (v: number) => void }) => (
  <div className="flex gap-1 text-2xl" role={onChange ? "radiogroup" : undefined}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)}
        aria-label={String(n)} aria-pressed={value >= n}
        className={`${onChange ? "cursor-pointer" : "cursor-default"} ${value >= n ? "text-warn" : "text-line"}`}
      >
        ★
      </button>
    ))}
  </div>
);

/** Buyer's own review of a delivered order — write-once, with an optional photo. */
export function ReviewForm({ orderId, review, reviewable }: { orderId: string; review: ReviewView | null; reviewable: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [cats, setCats] = useState<Record<(typeof CATEGORIES)[number], number>>({ timeliness: 0, asOrdered: 0, packaging: 0, driverConduct: 0, value: 0 });
  const [comment, setComment] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (review) {
    return (
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t("review.yourReview")}</h2>
        {review.removed ? (
          <Banner tone="info">{t("review.removedBanner")}</Banner>
        ) : (
          <>
            <Stars value={review.stars} />
            <p className="mt-1 text-xs text-muted">{fmtWhen(review.createdAt, locale)}</p>
            {review.comment ? <p className="mt-2 text-sm">{review.comment}</p> : null}
            {review.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={review.photoUrl} alt="" loading="lazy" className="mt-2 aspect-[4/3] w-32 rounded-[10px] border border-line object-cover" />
            ) : null}
            {review.reply ? (
              <div className="mt-3 rounded-[10px] border border-line bg-page p-3">
                <h3 className="text-sm font-semibold">{t("review.supplierReply")}</h3>
                <p className="mt-1 text-sm">{review.reply.text}</p>
              </div>
            ) : null}
          </>
        )}
      </Card>
    );
  }

  if (!reviewable) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("stars", String(stars));
      for (const c of CATEGORIES) if (cats[c] > 0) form.set(c, String(cats[c]));
      if (comment.trim()) form.set("comment", comment.trim());
      const file = fileRef.current?.files?.[0];
      if (file) form.set("file", file);
      await api(`/orders/${orderId}/review`, { form });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tint>
      <h2 className="mb-1 text-lg font-bold">{t("review.title")}</h2>
      <p className="mb-3 text-sm text-muted">{t("review.intro")}</p>
      {error ? <div className="mb-3"><Banner tone="bad" role="alert">{error}</Banner></div> : null}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("review.stars")}</label>
          <Stars value={stars} onChange={setStars} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div key={c}>
              <label className="mb-1 block text-xs text-muted">{t(`review.categories.${c}`)}</label>
              <Stars value={cats[c]} onChange={(v) => setCats((s) => ({ ...s, [c]: v }))} />
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="rev-comment" className="mb-1 block text-sm font-medium">{t("review.comment")}</label>
          <textarea id="rev-comment" className={`${inputCls} min-h-20`} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rev-photo" className="mb-1 block text-sm font-medium">{t("review.photo")}</label>
          <input id="rev-photo" ref={fileRef} type="file" accept="image/*" className="block w-full text-sm" />
        </div>
        <button type="button" className={btnCls("primary")} disabled={busy} onClick={submit}>
          {busy ? t("common.loading") : t("review.submit")}
        </button>
      </div>
    </Card>
  );
}
