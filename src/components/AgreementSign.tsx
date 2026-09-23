"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { toWesternDigits } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { AgreementText } from "./AgreementText";
import { Banner, Card, Field, btnCls, inputCls } from "./ui";

interface Props {
  type: "SUPPLIER_AGREEMENT" | "INDEPENDENT_AGREEMENT";
  doc: { version: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; sha256Ar: string; sha256En: string };
  companyName: string;
  hasName: boolean;
}

export function AgreementSign({ type, doc, companyName, hasName }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [lang, setLang] = useState<"AR" | "EN">(locale === "ar" ? "AR" : "EN");
  const [read, setRead] = useState(false);
  const [authorised, setAuthorised] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.messageFor(locale) : t("common.error"));

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ cooldownSeconds: number; devCode?: string }>("/terms/sign-code", { body: { type, version: doc.version } });
      setCodeSent(true);
      setCooldown(r.cooldownSeconds);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ certificateNo: string }>("/terms/accept", {
        body: { type, version: doc.version, language: lang, confirmRead: true, authorised: true, code: toWesternDigits(code).trim() },
      });
      setCertificate(r.certificateNo);
      router.refresh();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  if (certificate) {
    return (
      <Card tint>
        <Banner tone="ok" role="status">{t("agreement.signed")}</Banner>
        <p className="mt-3 text-sm">{t("agreement.certificateEmail")}</p>
        <div className="mt-3 flex gap-2">
          <a href={`/certificate/${certificate}`} className={btnCls("primary")}>{t("supplier.agreementView")}</a>
          <a href="/supplier" className={btnCls("secondary")}>{t("common.back")}</a>
        </div>
      </Card>
    );
  }

  const canSend = read && authorised && hasName;

  return (
    <div className="space-y-4">
      <AgreementText titleAr={doc.titleAr} titleEn={doc.titleEn} bodyAr={doc.bodyAr} bodyEn={doc.bodyEn} onLanguage={setLang} />
      <p className="text-xs text-muted">{t("agreement.arabicGoverns")}</p>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">{t("agreement.hash")}</summary>
        <p className="ltr-iso mt-1 break-all font-mono">AR: {doc.sha256Ar}</p>
        <p className="ltr-iso break-all font-mono">EN: {doc.sha256En}</p>
      </details>

      <Card>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1.5 size-4 accent-aqua-600" checked={read} onChange={(e) => setRead(e.target.checked)} />
            <span>{t("agreement.confirmRead")}</span>
          </label>
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1.5 size-4 accent-aqua-600" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} />
            <span>{t("agreement.confirmAuthorised", { company: companyName })}</span>
          </label>
          {!hasName ? <Banner tone="warn">{t("agreement.needName")} <a className="underline" href="/account?next=%2Fsupplier%2Fagreement">{t("common.account")}</a></Banner> : null}

          {!codeSent ? (
            <button type="button" className={btnCls("secondary")} disabled={!canSend || busy} onClick={sendCode}>
              {busy ? t("common.loading") : t("agreement.sendCode")}
            </button>
          ) : (
            <div className="space-y-3">
              {devCode ? <Banner tone="warn">{t("common.devMode", { code: devCode })}</Banner> : null}
              <Field label={t("agreement.codeLabel")} htmlFor="sign-code">
                <input id="sign-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} max-w-56 text-center text-2xl tracking-[0.4em]`} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnCls("primary")} disabled={busy || toWesternDigits(code).trim().length !== 6 || !canSend} onClick={sign}>
                  {busy ? t("common.loading") : t("agreement.sign")}
                </button>
                <button type="button" className="text-sm font-semibold text-aqua-700 underline disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || busy} onClick={sendCode}>
                  {cooldown > 0 ? t("auth.resendIn", { s: cooldown }) : t("auth.resend")}
                </button>
              </div>
            </div>
          )}
          {error ? <Banner tone="bad" role="alert">{error}</Banner> : null}
        </div>
      </Card>
    </div>
  );
}
