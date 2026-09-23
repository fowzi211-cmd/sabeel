"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { fmtWhen } from "@/lib/format";
import { formatSar, sarToHalalas } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, btnCls, inputCls } from "./ui";

const DELIVERY_OUTCOMES = ["REDELIVER", "PRICE_ADJUSTMENT", "CANCEL", "DISMISS"] as const;
const PAYMENT_OUTCOMES = ["PAYMENT_RECEIVED", "PAYMENT_STILL_DUE", "PAYMENT_VOID"] as const;

interface OpenDispute { id: string; category: string }

interface Props {
  orderId: string;
  status: string;
  canAct: boolean;
  /** Present when the delivery proof still awaits a review. */
  proofNeedsReview: boolean;
  /** The order's one open dispute, if any. */
  openDispute?: OpenDispute | null;
  totalHalalas: number;
}

/** Operations actions on one order: re-offer an escalated order, cancel, review proof, confirm after silence, resolve a dispute. */
export function AdminOrderActions({ orderId, status, canAct, proofNeedsReview, openDispute, totalHalalas }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmNote, setConfirmNote] = useState("");
  const [candidates, setCandidates] = useState<{ supplierId: string; supplierName: string; totalHalalas: number }[] | null>(null);
  const [pick, setPick] = useState("");

  const isPayment = openDispute?.category === "NON_PAYMENT";
  const outcomes = isPayment ? PAYMENT_OUTCOMES : DELIVERY_OUTCOMES;
  const [outcome, setOutcome] = useState<string>(outcomes[0]);
  const [resolutionNote, setResolutionNote] = useState("");
  const [adjustedSar, setAdjustedSar] = useState("");
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [slot, setSlot] = useState("");

  const cancellable = ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "ESCALATED", "FAILED_ATTEMPT"].includes(status);

  useEffect(() => {
    if (status !== "ESCALATED") return;
    api<{ candidates: { supplierId: string; supplierName: string; totalHalalas: number }[] }>(`/admin/orders/${orderId}/candidates`)
      .then((r) => setCandidates(r.candidates))
      .catch(() => setCandidates([]));
  }, [orderId, status]);

  useEffect(() => {
    if (!openDispute || isPayment || outcome !== "REDELIVER") return;
    api<{ slots: { start: string; end: string }[] }>(`/admin/orders/${orderId}/slots`).then((r) => {
      setSlots(r.slots);
      setSlot(r.slots[0]?.start ?? "");
    }).catch(() => setSlots([]));
  }, [openDispute, isPayment, outcome, orderId]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text: t("adminOps.done") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(null);
    }
  }

  const resolveDispute = () => {
    const adjustedTotalHalalas = outcome === "PRICE_ADJUSTMENT" ? (sarToHalalas(adjustedSar) ?? undefined) : undefined;
    return run("resolve", () => api(`/admin/disputes/${openDispute!.id}/resolve`, {
      body: { outcome, resolutionNote: resolutionNote.trim(), ...(adjustedTotalHalalas !== undefined ? { adjustedTotalHalalas } : {}), ...(outcome === "REDELIVER" ? { windowStart: slot } : {}) },
    }));
  };
  const resolveDisabled =
    !!busy || resolutionNote.trim().length < 2 ||
    (outcome === "PRICE_ADJUSTMENT" && (sarToHalalas(adjustedSar) === null || (sarToHalalas(adjustedSar) ?? 0) <= 0 || (sarToHalalas(adjustedSar) ?? 0) > totalHalalas)) ||
    (outcome === "REDELIVER" && !slot);

  if (!canAct || (!cancellable && !proofNeedsReview && status !== "ADMIN_REVIEW" && !openDispute)) return null;

  return (
    <Card>
      {msg ? <div className="mb-3"><Banner tone={msg.tone} role={msg.tone === "bad" ? "alert" : "status"}>{msg.text}</Banner></div> : null}

      {status === "ESCALATED" ? (
        <div className="mb-4 space-y-2">
          <h2 className="font-bold">{t("adminOps.reallocate")}</h2>
          {candidates && candidates.length === 0 ? <p className="text-sm text-muted">{t("adminOps.noCandidates")}</p> : null}
          {candidates && candidates.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <select className={`${inputCls} max-w-md`} aria-label={t("adminOps.reallocate")} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{t("adminOps.bestSupplier")}</option>
                {candidates.map((c) => <option key={c.supplierId} value={c.supplierId}>{t("adminOps.candidateLine", { name: c.supplierName, total: formatSar(c.totalHalalas, locale) })}</option>)}
              </select>
              <button type="button" className={btnCls("primary")} disabled={!!busy} onClick={() => run("re", () => api(`/admin/orders/${orderId}/reallocate`, { body: pick ? { supplierId: pick } : {} }))}>
                {busy === "re" ? t("common.loading") : t("adminOps.reallocate")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {proofNeedsReview ? (
        <div className="mb-4 space-y-2">
          <h2 className="font-bold">{t("adminOps.proofReview")}</h2>
          <label htmlFor="rv-note" className="block text-sm font-medium">{t("adminOps.reviewNote")}</label>
          <input id="rv-note" className={inputCls} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnCls("primary")} disabled={!!busy} onClick={() => run("ok", () => api(`/admin/orders/${orderId}/review-proof`, { body: { outcome: "OK", note: note.trim() || undefined } }))}>{t("adminOps.reviewOk")}</button>
            <button type="button" className={btnCls("danger")} disabled={!!busy || !note.trim()} onClick={() => run("bad", () => api(`/admin/orders/${orderId}/review-proof`, { body: { outcome: "SUSPICIOUS", note: note.trim() } }))}>{t("adminOps.reviewSuspicious")}</button>
          </div>
        </div>
      ) : null}

      {status === "ADMIN_REVIEW" ? (
        <div className="mb-4 space-y-2 border-t border-line pt-3">
          <h2 className="font-bold">{t("adminOps.confirmSilence")}</h2>
          <p className="text-sm text-muted">{t("adminOps.confirmSilenceHint")}</p>
          <label htmlFor="cf-note" className="block text-sm font-medium">{t("adminOps.confirmSilenceNote")}</label>
          <input id="cf-note" className={inputCls} maxLength={500} value={confirmNote} onChange={(e) => setConfirmNote(e.target.value)} />
          <button type="button" className={btnCls("primary")} disabled={!!busy || confirmNote.trim().length < 2} onClick={() => run("confirm", () => api(`/admin/orders/${orderId}/confirm`, { body: { note: confirmNote.trim() } }))}>
            {t("adminOps.confirmSilenceButton")}
          </button>
        </div>
      ) : null}

      {openDispute ? (
        <div className="mb-4 space-y-2 border-t border-line pt-3">
          <h2 className="font-bold">{t("adminOps.disputeResolve")}</h2>
          <p className="text-sm text-muted">{t(`dispute.category.${openDispute.category}`)}</p>
          <label htmlFor="dp-outcome" className="block text-sm font-medium">{t("adminOps.outcome")}</label>
          <select id="dp-outcome" className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {outcomes.map((o) => <option key={o} value={o}>{t(`dispute.outcome.${o}`)}</option>)}
          </select>
          {outcome === "PRICE_ADJUSTMENT" ? (
            <div>
              <label htmlFor="dp-adj" className="mb-1 block text-sm font-medium">{t("adminOps.newTotal", { max: formatSar(totalHalalas, locale) })}</label>
              <input id="dp-adj" dir="ltr" inputMode="decimal" className={`${inputCls} text-start`} value={adjustedSar} onChange={(e) => setAdjustedSar(e.target.value)} />
            </div>
          ) : null}
          {outcome === "REDELIVER" ? (
            <div>
              <label htmlFor="dp-slot" className="mb-1 block text-sm font-medium">{t("fulfil.newWindow")}</label>
              <select id="dp-slot" className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)} disabled={!slots}>
                {(slots ?? []).map((s) => <option key={s.start} value={s.start}>{fmtWhen(s.start, locale)}</option>)}
              </select>
              {slots && slots.length === 0 ? <p className="mt-1 text-sm text-bad">{t("adminOps.noSlots")}</p> : null}
            </div>
          ) : null}
          <label htmlFor="dp-note" className="block text-sm font-medium">{t("adminOps.resolutionNote")}</label>
          <textarea id="dp-note" className={`${inputCls} min-h-20`} maxLength={1000} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
          <button type="button" className={btnCls("primary")} disabled={resolveDisabled} onClick={resolveDispute}>
            {busy === "resolve" ? t("common.loading") : t("adminOps.disputeResolve")}
          </button>
        </div>
      ) : null}

      {cancellable ? (
        <div className="space-y-2 border-t border-line pt-3">
          <label htmlFor="cx" className="block text-sm font-medium">{t("adminOps.cancelReason")}</label>
          <input id="cx" className={inputCls} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <button type="button" className={btnCls("danger")} disabled={!!busy || cancelReason.trim().length < 2} onClick={() => run("cx", () => api(`/admin/orders/${orderId}/cancel`, { body: { reason: cancelReason.trim() } }))}>
            {t("adminOps.cancelOrder")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
