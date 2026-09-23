"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { AgreementText } from "./AgreementText";
import { Banner, Card, btnCls } from "./ui";

interface Props {
  doc: { version: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; legalReviewed: boolean };
  accepted: boolean;
  hasName: boolean;
  /** Where to go after accepting (e.g. back to the order page). */
  next?: string;
}

export function BuyerTermsCard({ doc, accepted, hasName, next }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [lang, setLang] = useState<"AR" | "EN">(locale === "ar" ? "AR" : "EN");
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/terms/accept", { body: { type: "BUYER_TERMS", version: doc.version, language: lang, confirmRead: true } });
      if (next && next !== "/account") router.push(next);
      else router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t("account.buyerTerms")}</h2>
        {!doc.legalReviewed ? <span className="text-xs font-semibold text-warn">{t("common.draftBadge")}</span> : null}
      </div>
      <AgreementText titleAr={doc.titleAr} titleEn={doc.titleEn} bodyAr={doc.bodyAr} bodyEn={doc.bodyEn} onLanguage={setLang} maxHeightClass="max-h-72" />
      <div className="mt-4">
        {accepted ? (
          <Banner tone="ok">{t("account.buyerTermsDone", { version: doc.version })}</Banner>
        ) : (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-aqua-600" checked={read} onChange={(e) => setRead(e.target.checked)} />
              <span>{t("account.buyerTermsAccept")}</span>
            </label>
            {!hasName ? <Banner tone="warn">{t("agreement.needName")}</Banner> : null}
            {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
            <button type="button" className={btnCls("primary")} disabled={!read || busy || !hasName} onClick={accept}>
              {busy ? t("common.loading") : t("common.confirm")}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
