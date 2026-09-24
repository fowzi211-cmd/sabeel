"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, btnCls, inputCls } from "./ui";

export interface SupplierReviewRow {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string | Date;
  orderNo: string;
  buyerFirstName: string;
  reply: { text: string; createdAt: string | Date } | null;
  flag: { status: "OPEN" | "DISMISSED" | "UPHELD" } | null;
}

const Stars = ({ n }: { n: number }) => <span className="text-warn" aria-hidden>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;

export function SupplierReviewsList({ reviews }: { reviews: SupplierReviewRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [flagging, setFlagging] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }
  const reply = (id: string) => run(() => api(`/supplier/reviews/${id}/reply`, { body: { text: text.trim() } }), () => { setOpen(null); setText(""); });
  const flag = (id: string) => run(() => api(`/supplier/reviews/${id}/flag`, { body: { reason: reason.trim() } }), () => { setFlagging(null); setReason(""); });

  if (reviews.length === 0) return <Card><p className="text-muted">{t("supplierReviews.empty")}</p></Card>;

  return (
    <div className="space-y-3">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      {reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Stars n={r.stars} /> <span className="ms-2 text-sm text-muted">{r.buyerFirstName} · <span className="ltr-iso font-mono">{r.orderNo}</span></span>
            </div>
            <span className="text-xs text-muted">{fmtWhen(r.createdAt, locale)}</span>
          </div>
          {r.comment ? <p className="mt-2 text-sm">{r.comment}</p> : null}

          {r.reply ? (
            <div className="mt-3 rounded-[10px] border border-line bg-page p-3">
              <h3 className="text-sm font-semibold">{t("review.supplierReply")}</h3>
              <p className="mt-1 text-sm">{r.reply.text}</p>
            </div>
          ) : open === r.id ? (
            <div className="mt-3 space-y-2">
              <textarea className={`${inputCls} min-h-16`} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("supplierReviews.replyPlaceholder")} />
              <button type="button" className={btnCls("primary", "!min-h-9 !py-1.5 text-sm")} disabled={busy || text.trim().length < 2} onClick={() => reply(r.id)}>
                {busy ? t("common.loading") : t("supplierReviews.replySubmit")}
              </button>
            </div>
          ) : (
            <button type="button" className={btnCls("ghost", "!min-h-9 !px-0 !py-1.5 text-sm")} onClick={() => setOpen(r.id)}>{t("supplierReviews.replySubmit")}</button>
          )}

          <div className="mt-2">
            {r.flag ? (
              <Chip tone={r.flag.status === "OPEN" ? "warn" : "neutral"}>{t(`supplierReviews.flagStatus.${r.flag.status}`)}</Chip>
            ) : flagging === r.id ? (
              <div className="space-y-2">
                <textarea className={`${inputCls} min-h-14 text-sm`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("supplierReviews.flagPlaceholder")} />
                <button type="button" className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")} disabled={busy || reason.trim().length < 5} onClick={() => flag(r.id)}>
                  {busy ? t("common.loading") : t("supplierReviews.flagSubmit")}
                </button>
              </div>
            ) : (
              <button type="button" className={btnCls("ghost", "!min-h-9 !px-0 !py-1.5 text-sm")} onClick={() => setFlagging(r.id)}>{t("supplierReviews.flagButton")}</button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
