"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, btnCls, inputCls } from "./ui";

export interface AdminReviewRow {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  orderNo: string;
  supplierName: string;
  buyerName: string | null;
  removedAt: string | null;
  reply: { text: string } | null;
  flag: { status: "OPEN" | "DISMISSED" | "UPHELD"; reason: string } | null;
}

const Stars = ({ n }: { n: number }) => <span className="text-warn" aria-hidden>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;

export function AdminReviewsList({ reviews }: { reviews: AdminReviewRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; kind: "remove" | "dismiss" } | null>(null);
  const [reason, setReason] = useState("");

  async function submit(id: string, kind: "remove" | "dismiss") {
    setBusy(id);
    setError(null);
    try {
      if (kind === "remove") await api(`/admin/reviews/${id}/remove`, { body: { reason: reason.trim() } });
      else await api(`/admin/reviews/${id}/dismiss-flag`, { body: { note: reason.trim() } });
      setActing(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) return <Card><p className="text-muted">{t("adminReviews.empty")}</p></Card>;

  return (
    <div className="space-y-3">
      {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
      {reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Stars n={r.stars} /> <span className="ms-2 text-sm text-muted">{r.buyerName ?? "—"} → {r.supplierName} · <span className="ltr-iso font-mono">{r.orderNo}</span></span>
            </div>
            <span className="text-xs text-muted">{fmtWhen(r.createdAt, locale)}</span>
          </div>
          {r.comment ? <p className="mt-2 text-sm">{r.comment}</p> : null}
          {r.reply ? <p className="mt-2 text-sm text-muted">{t("review.supplierReply")}: {r.reply.text}</p> : null}
          {r.flag ? (
            <div className="mt-2 rounded-[10px] border border-line bg-page p-3 text-sm">
              <Chip tone={r.flag.status === "OPEN" ? "warn" : "neutral"}>{t(`adminReviews.flagStatus.${r.flag.status}`)}</Chip>
              <p className="mt-1"><span className="font-semibold">{t("adminReviews.flagReason")}:</span> {r.flag.reason}</p>
            </div>
          ) : null}

          {r.removedAt ? (
            <p className="mt-2 text-sm font-medium text-bad">{t("adminReviews.removedBanner")}</p>
          ) : acting?.id === r.id ? (
            <div className="mt-3 space-y-1.5">
              <textarea className={`${inputCls} min-h-14 text-sm`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(acting.kind === "remove" ? "adminReviews.removeReasonPrompt" : "adminReviews.dismissNotePrompt")} />
              <button type="button" disabled={busy === r.id || reason.trim().length < 2} className={btnCls(acting.kind === "remove" ? "danger" : "primary", "!min-h-9 !py-1.5 text-sm")} onClick={() => submit(r.id, acting.kind)}>
                {busy === r.id ? t("common.loading") : t(acting.kind === "remove" ? "adminReviews.removeButton" : "adminReviews.dismissButton")}
              </button>
            </div>
          ) : (
            <div className="mt-2 flex gap-4">
              <button type="button" className={btnCls("ghost", "!min-h-9 !px-0 !py-1.5 text-sm")} onClick={() => { setActing({ id: r.id, kind: "remove" }); setReason(""); }}>{t("adminReviews.removeButton")}</button>
              {r.flag?.status === "OPEN" ? (
                <button type="button" className={btnCls("ghost", "!min-h-9 !px-0 !py-1.5 text-sm")} onClick={() => { setActing({ id: r.id, kind: "dismiss" }); setReason(""); }}>{t("adminReviews.dismissButton")}</button>
              ) : null}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
