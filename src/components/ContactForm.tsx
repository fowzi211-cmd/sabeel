"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { normalizeSaudiMobile } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Field, btnCls, inputCls } from "./ui";

export function ContactForm({ contactName, contactMobile, contactEmail }: { contactName: string; contactMobile: string; contactEmail: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ contactName, contactMobile, contactEmail });
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!normalizeSaudiMobile(f.contactMobile)) return setMsg({ tone: "bad", text: t("errors.mobile") });
    setBusy(true);
    try {
      await api("/supplier/profile", { method: "PATCH", body: f });
      setMsg({ tone: "ok", text: t("common.saved") });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof ApiError ? err.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 grid gap-3 sm:grid-cols-3">
      <Field label={t("supplier.contactName")} htmlFor="c-name">
        <input id="c-name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} className={inputCls} />
      </Field>
      <Field label={t("supplier.contactMobile")} htmlFor="c-mobile">
        <input id="c-mobile" dir="ltr" value={f.contactMobile} onChange={(e) => setF({ ...f, contactMobile: e.target.value })} className={`${inputCls} text-start`} />
      </Field>
      <Field label={t("supplier.contactEmail")} htmlFor="c-email">
        <input id="c-email" dir="ltr" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} className={`${inputCls} text-start`} />
      </Field>
      <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnCls("secondary")}>{busy ? t("common.loading") : t("common.save")}</button>
        {msg ? <Banner tone={msg.tone} role="status">{msg.text}</Banner> : null}
      </div>
    </form>
  );
}
