"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/provider";

interface Props {
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  /** Called when the reader switches language, so the signing record reflects what was shown. */
  onLanguage?: (lang: "AR" | "EN") => void;
  maxHeightClass?: string;
}

/** Renders "## Heading" + paragraph text with a language switch. Always uses the text's own direction. */
export function AgreementText({ titleAr, titleEn, bodyAr, bodyEn, onLanguage, maxHeightClass = "max-h-[420px]" }: Props) {
  const { locale, t } = useI18n();
  const [lang, setLang] = useState<"AR" | "EN">(locale === "ar" ? "AR" : "EN");
  const body = lang === "AR" ? bodyAr : bodyEn;
  const title = lang === "AR" ? titleAr : titleEn;

  // One entry per non-empty line: "## Heading" lines become headings, everything else a paragraph.
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

  const pick = (l: "AR" | "EN") => {
    setLang(l);
    onLanguage?.(l);
  };
  const tab = (active: boolean) =>
    `rounded-full px-3.5 py-1 text-sm font-semibold ${active ? "bg-aqua-600 text-white" : "bg-[#EEF3F5] text-muted hover:bg-aqua-100"}`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2" role="tablist" aria-label={t("agreement.readIn")}>
        <span className="text-sm text-muted">{t("agreement.readIn")}</span>
        <button type="button" role="tab" aria-selected={lang === "AR"} className={tab(lang === "AR")} onClick={() => pick("AR")}>
          العربية
        </button>
        <button type="button" role="tab" aria-selected={lang === "EN"} className={tab(lang === "EN")} onClick={() => pick("EN")}>
          English
        </button>
      </div>
      <div
        dir={lang === "AR" ? "rtl" : "ltr"}
        lang={lang === "AR" ? "ar" : "en"}
        tabIndex={0}
        className={`agreement-text overflow-y-auto rounded-xl border border-line bg-white p-4 text-[15px] leading-7 ${maxHeightClass}`}
      >
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        {lines.map((line, i) => (line.startsWith("## ") ? <h3 key={i}>{line.slice(3)}</h3> : <p key={i}>{line}</p>))}
      </div>
    </div>
  );
}
