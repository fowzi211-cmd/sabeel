import { getI18n } from "@/i18n";
import { fmtWhen } from "@/lib/format";
import { Banner, Card, Chip } from "./ui";

export interface ProofPhotoView { id: string; kind: string; capturedAt: Date | string; url: string; source?: string; flags?: string[] }

/** Proof of delivery as staff and the supplier see it. `admin` adds the reviewer details (distances, flags, reasons). */
export interface ProofView {
  radiusOk: boolean;
  brandPhotoOk: boolean;
  recipientOtpOk: boolean;
  partial: boolean;
  batchNote: string | null;
  notes: string | null;
  distanceM: number | null;
  radiusM: number;
  outsideReason: string | null;
  otpBypassReason: string | null;
  submittedOffline: boolean;
  flags: string[];
  reviewRequired: boolean;
  reviewReasons: string[];
  reviewedAt: Date | string | null;
  reviewOutcome: string | null;
  reviewNote: string | null;
  photos: ProofPhotoView[];
}

interface Line { id: string; brandNameAr: string; brandNameEn: string; qtyPacks: number; deliveredQtyPacks: number | null }

export async function ProofPanel({ proof, items, audience }: { proof: ProofView; items: Line[]; audience: "supplier" | "admin" }) {
  const { t, locale } = await getI18n();
  const admin = audience === "admin";
  const reviewed = !!proof.reviewedAt;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t("fulfil.proofTitle")}</h2>
        <div className="flex flex-wrap gap-1.5">
          {proof.partial ? <Chip tone="warn">{t("fulfil.partial")}</Chip> : null}
          {reviewed ? <Chip tone={proof.reviewOutcome === "SUSPICIOUS" ? "bad" : "ok"}>{proof.reviewOutcome === "SUSPICIOUS" ? t("fulfil.reviewedBad") : t("fulfil.reviewedOk")}</Chip> : proof.reviewRequired ? <Chip tone="info">{t("fulfil.reviewPending")}</Chip> : null}
        </div>
      </div>

      <ul className="mb-3 space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.id}>{locale === "ar" ? i.brandNameAr : i.brandNameEn} — {t("fulfil.deliveredQty", { d: i.deliveredQtyPacks ?? 0, o: i.qtyPacks })}</li>
        ))}
      </ul>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip tone={proof.radiusOk ? "ok" : "warn"}>{proof.radiusOk ? t("fulfil.atLocation") : t("fulfil.awayFromLocation")}</Chip>
        <Chip tone={proof.recipientOtpOk ? "ok" : "warn"}>{proof.recipientOtpOk ? t("fulfil.codeOk") : t("fulfil.codeMissing")}</Chip>
        {admin && proof.submittedOffline ? <Chip tone="info">{t("adminOps.offlineSent")}</Chip> : null}
      </div>

      {proof.batchNote ? <p className="mb-2 text-sm"><span className="text-muted">{t("fulfil.batchNote")}: </span>{proof.batchNote}</p> : null}
      {proof.notes ? <p className="mb-2 text-sm">{proof.notes}</p> : null}

      {admin ? (
        <div className="mb-3 space-y-1 text-sm">
          {proof.distanceM !== null ? <div><span className="text-muted">{t("adminOps.distance")}: </span><span className="ltr-iso">{proof.distanceM} m / {proof.radiusM} m</span></div> : null}
          {proof.outsideReason ? <div><span className="text-muted">{t("adminOps.outsideReason")}: </span>{proof.outsideReason}</div> : null}
          {proof.otpBypassReason ? <div><span className="text-muted">{t("adminOps.bypassReason")}: </span>{proof.otpBypassReason}</div> : null}
          {proof.flags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {proof.flags.map((f) => <Chip key={f} tone="warn">{t(`adminOps.flags.${f}`)}</Chip>)}
            </div>
          ) : null}
          {proof.reviewReasons.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {proof.reviewReasons.map((r) => <Chip key={r} tone="info">{t(`adminOps.reasons.${r}`)}</Chip>)}
            </div>
          ) : null}
          {proof.reviewNote ? <Banner tone={proof.reviewOutcome === "SUSPICIOUS" ? "bad" : "info"}>{proof.reviewNote}</Banner> : null}
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {proof.photos.filter((p) => p.kind !== "FAILURE").map((p) => (
          <li key={p.id} className="overflow-hidden rounded-[10px] border border-line bg-page">
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* Private, authorised route: not a candidate for the public image optimiser. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={t(`fulfil.photoKind.${p.kind}`)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            </a>
            <div className="px-2 py-1 text-xs text-muted">
              {t(`fulfil.photoKind.${p.kind}`)} · {fmtWhen(p.capturedAt, locale)}
              {admin && p.flags && p.flags.length > 0 ? <span className="text-warn"> · {p.flags.map((f) => t(`adminOps.flags.${f}`)).join("، ")}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
