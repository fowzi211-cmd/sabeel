"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import {
  hasArabic,
  isValidCrNumber,
  isValidEmail,
  isValidFreelanceNumber,
  isValidSaudiIdNumber,
  isValidVatNumber,
  normalizeSaudiMobile,
} from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Field, btnCls, inputCls } from "./ui";

type Type = "BRAND_COMPANY" | "INDEPENDENT";
type Errors = Record<string, string>;

export function ApplyForm({ defaultName, defaultMobile }: { defaultName: string; defaultMobile: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [type, setType] = useState<Type>("BRAND_COMPANY");
  const [f, setF] = useState({
    legalNameAr: "", legalNameEn: "", tradeName: "", registrationKind: "CR" as "CR" | "FREELANCE",
    crNumber: "", vatNumber: "", contactName: defaultName, contactMobile: defaultMobile, contactEmail: "",
    idNumber: "", vehiclePlate: "", driverLicenseNo: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const independent = type === "INDEPENDENT";

  function validate(): Errors {
    const e: Errors = {};
    if (!f.legalNameAr.trim()) e.legalNameAr = t("errors.required");
    else if (!hasArabic(f.legalNameAr)) e.legalNameAr = t("errors.arabicName");
    if (!f.contactName.trim()) e.contactName = t("errors.required");
    if (!normalizeSaudiMobile(f.contactMobile)) e.contactMobile = t("errors.mobile");
    if (f.contactEmail.trim() && !isValidEmail(f.contactEmail)) e.contactEmail = t("errors.email");

    const kind = independent ? f.registrationKind : "CR";
    if (kind === "CR" ? !isValidCrNumber(f.crNumber) : !isValidFreelanceNumber(f.crNumber)) {
      e.crNumber = kind === "CR" ? t("errors.cr10") : t("errors.freelance");
    }
    if (!independent && !isValidVatNumber(f.vatNumber)) e.vatNumber = t("errors.vat15");
    if (independent && f.vatNumber.trim() && !isValidVatNumber(f.vatNumber)) e.vatNumber = t("errors.vat15");
    if (independent) {
      if (!isValidSaudiIdNumber(f.idNumber)) e.idNumber = t("errors.id10");
      if (!f.vehiclePlate.trim()) e.vehiclePlate = t("errors.required");
      if (!f.driverLicenseNo.trim()) e.driverLicenseNo = t("errors.required");
    }
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;

    setBusy(true);
    try {
      await api("/supplier/apply", {
        body: {
          type,
          legalNameAr: f.legalNameAr,
          legalNameEn: f.legalNameEn,
          tradeName: f.tradeName,
          registrationKind: independent ? f.registrationKind : "CR",
          crNumber: f.crNumber,
          vatNumber: f.vatNumber,
          contactName: f.contactName,
          contactMobile: f.contactMobile,
          contactEmail: f.contactEmail,
          ...(independent ? { idNumber: f.idNumber, vehiclePlate: f.vehiclePlate, driverLicenseNo: f.driverLicenseNo } : {}),
        },
      });
      router.replace("/2fa?setup=1&next=%2Fsupplier");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const issues = (err.details?.issues as { field: string; message: string }[] | undefined) ?? [];
        if (issues.length) setErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
        else if (err.field) setErrors({ [err.field]: err.messageFor(locale) });
        setFormError(err.messageFor(locale));
      } else setFormError(t("common.error"));
      setBusy(false);
    }
  }

  const typeCard = (value: Type, title: string, help: string) => (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 ${type === value ? "border-aqua-600 bg-aqua-100" : "border-line bg-white hover:border-aqua-500"}`}
    >
      <input type="radio" name="type" className="mt-1 size-4 accent-aqua-600" checked={type === value} onChange={() => setType(value)} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{help}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Card>
        <p className="mb-2 font-semibold">{t("supplier.type")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {typeCard("BRAND_COMPANY", t("supplier.typeBrand"), t("supplier.typeBrandHelp"))}
          {typeCard("INDEPENDENT", t("supplier.typeIndependent"), t("supplier.typeIndependentHelp"))}
        </div>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label={t("supplier.legalNameAr")} htmlFor="legalNameAr" error={errors.legalNameAr}>
          <input id="legalNameAr" dir="rtl" value={f.legalNameAr} onChange={set("legalNameAr")} className={inputCls} />
        </Field>
        <Field label={`${t("supplier.legalNameEn")} (${t("common.optional")})`} htmlFor="legalNameEn" error={errors.legalNameEn}>
          <input id="legalNameEn" dir="ltr" value={f.legalNameEn} onChange={set("legalNameEn")} className={`${inputCls} text-start`} />
        </Field>
        <Field label={`${t("supplier.tradeName")} (${t("common.optional")})`} htmlFor="tradeName" error={errors.tradeName}>
          <input id="tradeName" value={f.tradeName} onChange={set("tradeName")} className={inputCls} />
        </Field>

        {independent ? (
          <Field label={t("supplier.regKind")} htmlFor="registrationKind">
            <select id="registrationKind" value={f.registrationKind} onChange={set("registrationKind")} className={inputCls}>
              <option value="CR">{t("supplier.regCR")}</option>
              <option value="FREELANCE">{t("supplier.regFreelance")}</option>
            </select>
          </Field>
        ) : null}
        <Field label={independent && f.registrationKind === "FREELANCE" ? t("supplier.freelanceNumber") : t("supplier.crNumber")} htmlFor="crNumber" error={errors.crNumber}>
          <input id="crNumber" dir="ltr" inputMode="numeric" value={f.crNumber} onChange={set("crNumber")} className={`${inputCls} text-start`} />
        </Field>
        <Field label={independent ? `${t("supplier.vatNumber")} (${t("common.optional")})` : t("supplier.vatNumber")} htmlFor="vatNumber" error={errors.vatNumber}>
          <input id="vatNumber" dir="ltr" inputMode="numeric" value={f.vatNumber} onChange={set("vatNumber")} className={`${inputCls} text-start`} />
        </Field>
      </Card>

      {independent ? (
        <Card className="grid gap-4 sm:grid-cols-3">
          <Field label={t("supplier.idNumber")} htmlFor="idNumber" error={errors.idNumber}>
            <input id="idNumber" dir="ltr" inputMode="numeric" value={f.idNumber} onChange={set("idNumber")} className={`${inputCls} text-start`} />
          </Field>
          <Field label={t("supplier.vehiclePlate")} htmlFor="vehiclePlate" error={errors.vehiclePlate}>
            <input id="vehiclePlate" value={f.vehiclePlate} onChange={set("vehiclePlate")} className={inputCls} />
          </Field>
          <Field label={t("supplier.driverLicenseNo")} htmlFor="driverLicenseNo" error={errors.driverLicenseNo}>
            <input id="driverLicenseNo" dir="ltr" value={f.driverLicenseNo} onChange={set("driverLicenseNo")} className={`${inputCls} text-start`} />
          </Field>
        </Card>
      ) : null}

      <Card className="grid gap-4 sm:grid-cols-3">
        <Field label={t("supplier.contactName")} htmlFor="contactName" error={errors.contactName}>
          <input id="contactName" value={f.contactName} onChange={set("contactName")} className={inputCls} />
        </Field>
        <Field label={t("supplier.contactMobile")} htmlFor="contactMobile" error={errors.contactMobile}>
          <input id="contactMobile" type="tel" dir="ltr" value={f.contactMobile} onChange={set("contactMobile")} className={`${inputCls} text-start`} />
        </Field>
        <Field label={`${t("supplier.contactEmail")} (${t("common.optional")})`} htmlFor="contactEmail" error={errors.contactEmail}>
          <input id="contactEmail" type="email" dir="ltr" value={f.contactEmail} onChange={set("contactEmail")} className={`${inputCls} text-start`} />
        </Field>
      </Card>

      {independent ? <Banner tone="info">{t("supplier.independentProbation", { n: 10 })}</Banner> : null}
      {formError ? <Banner tone="bad" role="alert">{formError}</Banner> : null}
      <button type="submit" disabled={busy} className={btnCls("primary")}>
        {busy ? t("common.loading") : t("supplier.createApplication")}
      </button>
    </form>
  );
}
