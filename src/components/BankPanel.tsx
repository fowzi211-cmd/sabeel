"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { isValidSaudiIban, normalizeIban } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Chip, Field, btnCls, fmtDate, inputCls, statusTone } from "./ui";

export interface BankView {
  id: string;
  iban: string;
  holderName: string;
  bankName: string | null;
  status: "PENDING" | "ACTIVE" | "REPLACED" | "REJECTED";
  cooldownUntil: string | null;
  rejectReason: string | null;
}

const groupIban = (i: string) => i.replace(/(.{4})/g, "$1 ").trim();

export function BankPanel({ accounts, canEdit, hasActive }: { accounts: BankView[]; canEdit: boolean; hasActive: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(accounts.filter((a) => a.status !== "REPLACED" && a.status !== "REJECTED").length === 0);
  const [iban, setIban] = useState("");
  const [holderName, setHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!isValidSaudiIban(iban)) return setErr({ field: "iban", msg: t("errors.iban") });
    if (holderName.trim().length < 2) return setErr({ field: "holderName", msg: t("errors.required") });
    setBusy(true);
    try {
      await api("/supplier/bank-accounts", { body: { iban, holderName, bankName } });
      setIban(""); setHolderName(""); setBankName(""); setOpen(false);
      router.refresh();
    } catch (error) {
      setErr({ field: error instanceof ApiError ? error.field : undefined, msg: error instanceof ApiError ? error.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  const visible = accounts.filter((a) => a.status !== "REPLACED");

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("supplier.bankIntro")}</p>

      {visible.map((a) => (
        <div key={a.id} className="rounded-xl border border-line bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="ltr-iso font-mono font-semibold">{groupIban(a.iban)}</span>
            <Chip tone={statusTone(a.status === "PENDING" ? "PENDING" : a.status)}>{t(`supplier.bankStatus.${a.status}`)}</Chip>
          </div>
          <p className="mt-1 text-sm text-muted">{a.holderName}{a.bankName ? ` · ${a.bankName}` : ""}</p>
          {a.status === "PENDING" && a.cooldownUntil && new Date(a.cooldownUntil) > new Date() ? (
            <p className="mt-1 text-xs text-warn">{t("supplier.bankCooldown", { time: fmtDate(a.cooldownUntil, locale, true) })}</p>
          ) : null}
          {a.rejectReason ? <p className="mt-1 text-sm text-bad">{t("supplier.rejectedReason", { reason: a.rejectReason })}</p> : null}
        </div>
      ))}

      {canEdit && !open ? (
        <button type="button" className={btnCls("secondary")} onClick={() => setOpen(true)}>{t("supplier.changeBank")}</button>
      ) : null}

      {canEdit && open ? (
        <form onSubmit={submit} noValidate className="space-y-3 rounded-xl bg-page p-3">
          {hasActive ? <Banner tone="warn">{t("supplier.bankCooldown", { time: "48h" })}</Banner> : null}
          <Field label={t("supplier.iban")} htmlFor="iban" hint={t("supplier.ibanHint")} error={err?.field === "iban" ? err.msg : null}>
            <input id="iban" dir="ltr" value={iban} onChange={(e) => setIban(e.target.value)} onBlur={() => setIban(groupIban(normalizeIban(iban)))} className={`${inputCls} text-start font-mono`} placeholder="SA00 0000 0000 0000 0000 0000" />
          </Field>
          <Field label={t("supplier.holderName")} htmlFor="holder" hint={t("supplier.holderHelp")} error={err?.field === "holderName" ? err.msg : null}>
            <input id="holder" value={holderName} onChange={(e) => setHolderName(e.target.value)} className={inputCls} />
          </Field>
          <Field label={`${t("supplier.bankName")} (${t("common.optional")})`} htmlFor="bank">
            <input id="bank" value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} />
          </Field>
          {err && !err.field ? <Banner tone="bad" role="alert">{err.msg}</Banner> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnCls("primary")}>{busy ? t("common.loading") : t("supplier.addBank")}</button>
            {visible.length > 0 ? <button type="button" className={btnCls("ghost")} onClick={() => setOpen(false)}>{t("common.cancel")}</button> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
