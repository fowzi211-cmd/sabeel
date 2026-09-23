"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { feeHalalas, formatSar, packetEqMilliFor, sarToHalalas, supplierKeeps } from "@/lib/money";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, btnCls, inputCls } from "./ui";

export interface OfferRow {
  id: string; bottleMl: number; bottlesPerPack: number; packetEqMilli: number; priceHalalas: number; minQtyPacks: number;
  stock: "IN_STOCK" | "LIMITED" | "OUT"; active: boolean; brand: { id: string; nameAr: string; nameEn: string; status: string };
}
interface BrandOpt { id: string; nameAr: string; nameEn: string }

const SIZES = [200, 250, 330, 500, 600, 750, 1000, 1500, 5000, 19000];
const PACKS = [1, 6, 12, 20, 24, 48];
const toSar = (h: number) => (h / 100).toFixed(2);

/** Live "what you keep" panel — the supplier must always see the fee (FR-FEE-06). */
function Calculator({ priceHalalas, packetEqMilli, feePerPacket }: { priceHalalas: number | null; packetEqMilli: number; feePerPacket: number }) {
  const { t, locale } = useI18n();
  if (priceHalalas === null) return null;
  const fee = feeHalalas(packetEqMilli, 1, feePerPacket);
  const k = supplierKeeps(priceHalalas, fee);
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? "border-t border-[#BFE3EA] pt-1 font-bold" : ""}`}><span>{label}</span><span>{value}</span></div>
  );
  return (
    <div className="rounded-xl border border-[#BFE3EA] bg-aqua-100 p-3 text-sm" aria-live="polite">
      <div className="mb-1 text-xs font-semibold text-aqua-700">{t("catalogue.calc")}</div>
      {row(t("catalogue.buyerPays"), formatSar(priceHalalas, locale))}
      {row(t("catalogue.platformFee"), `− ${formatSar(k.fee, locale)}`)}
      {row(t("catalogue.vatOnFee"), `− ${formatSar(k.feeVat, locale)}`)}
      {row(t("catalogue.youKeep"), formatSar(k.keep, locale), true)}
      <div className="mt-1 text-[11px] text-muted">{t("catalogue.packetEq", { n: (packetEqMilli / 1000).toString() })} · {t("catalogue.about")}</div>
    </div>
  );
}

function OfferCard({ o, feePerPacket, canEdit }: { o: OfferRow; feePerPacket: number; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [price, setPrice] = useState(toSar(o.priceHalalas));
  const [minQty, setMinQty] = useState(String(o.minQtyPacks));
  const [stock, setStock] = useState(o.stock);
  const [active, setActive] = useState(o.active);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const priceH = sarToHalalas(price);
  const dirty = priceH !== o.priceHalalas || Number(minQty) !== o.minQtyPacks || stock !== o.stock || active !== o.active;

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ tone: "ok", text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }
  const save = () => {
    if (priceH === null || !Number.isInteger(Number(minQty)) || Number(minQty) < 1) return setMsg({ tone: "bad", text: t("errors.required") });
    run(() => api(`/supplier/offers/${o.id}`, { method: "PATCH", body: { priceHalalas: priceH, minQtyPacks: Number(minQty), stock, active } }), t("common.saved"));
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{locale === "ar" ? o.brand.nameAr : o.brand.nameEn}</div>
          <div className="text-sm text-muted">{t("orders.packLine", { ml: o.bottleMl, n: o.bottlesPerPack })}</div>
        </div>
        <div className="flex gap-1.5">
          {o.brand.status !== "ACTIVE" ? <Chip tone="bad">{t("catalogue.frozenBrand")}</Chip> : null}
          <Chip tone={o.active ? "ok" : "neutral"}>{o.active ? t("catalogue.active") : "—"}</Chip>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("catalogue.price")} htmlFor={`p-${o.id}`} error={priceH === null ? t("errors.required") : null}>
          <input id={`p-${o.id}`} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!canEdit} className={`${inputCls} text-start`} />
        </Field>
        <Field label={t("catalogue.minQty")} htmlFor={`m-${o.id}`}>
          <input id={`m-${o.id}`} dir="ltr" inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ""))} disabled={!canEdit} className={`${inputCls} text-start`} />
        </Field>
        <Field label={t("catalogue.stock")} htmlFor={`s-${o.id}`}>
          <select id={`s-${o.id}`} value={stock} onChange={(e) => setStock(e.target.value as OfferRow["stock"])} disabled={!canEdit} className={inputCls}>
            <option value="IN_STOCK">{t("catalogue.stockIn")}</option>
            <option value="LIMITED">{t("catalogue.stockLimited")}</option>
            <option value="OUT">{t("catalogue.stockOut")}</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input type="checkbox" className="size-4 accent-aqua-600" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canEdit} />
          {t("catalogue.active")}
        </label>
      </div>
      <Calculator priceHalalas={priceH} packetEqMilli={o.packetEqMilli} feePerPacket={feePerPacket} />
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnCls("primary")} disabled={busy || !dirty} onClick={save}>{busy ? t("common.loading") : t("catalogue.save")}</button>
          <button type="button" className={btnCls("danger")} disabled={busy} onClick={() => run(() => api(`/supplier/offers/${o.id}`, { method: "DELETE" }))}>{t("catalogue.remove")}</button>
          {msg ? <Banner tone={msg.tone} role="status">{msg.text}</Banner> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function CatalogueManager({ offers, brands, feePerPacket, canEdit }: { offers: OfferRow[]; brands: BrandOpt[]; feePerPacket: number; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ brandId: "", bottleMl: "500", bottlesPerPack: "20", price: "", minQty: "1", stock: "IN_STOCK" as OfferRow["stock"] });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const priceH = sarToHalalas(f.price);
  const eq = packetEqMilliFor(Number(f.bottlesPerPack), Number(f.bottleMl));

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.brandId) return setErr({ field: "brandId", msg: t("errors.required") });
    if (priceH === null) return setErr({ field: "price", msg: t("errors.required") });
    setBusy(true);
    try {
      await api("/supplier/offers", { body: { brandId: f.brandId, bottleMl: Number(f.bottleMl), bottlesPerPack: Number(f.bottlesPerPack), priceHalalas: priceH, minQtyPacks: Number(f.minQty) || 1, stock: f.stock } });
      setF({ ...f, price: "" });
      router.refresh();
    } catch (error) {
      setErr({ field: error instanceof ApiError ? error.field : undefined, msg: error instanceof ApiError ? error.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Banner tone="info">{t("catalogue.feeNotice", { fee: formatSar(feePerPacket, locale) })}</Banner>

      {offers.length === 0 ? <Card><p className="text-muted">{t("catalogue.empty")}</p></Card> : null}
      {offers.map((o) => <OfferCard key={o.id} o={o} feePerPacket={feePerPacket} canEdit={canEdit} />)}

      {canEdit ? (
        <Card>
          <h2 className="mb-3 text-lg font-bold">{t("catalogue.addOffer")}</h2>
          <form onSubmit={add} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label={t("catalogue.brand")} htmlFor="n-brand" hint={t("catalogue.brandHelp")} error={err?.field === "brandId" ? err.msg : null}>
              <select id="n-brand" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{locale === "ar" ? b.nameAr : b.nameEn}</option>)}
              </select>
            </Field>
            <Field label={t("catalogue.price")} htmlFor="n-price" error={err?.field === "price" ? err.msg : null}>
              <input id="n-price" dir="ltr" inputMode="decimal" placeholder="9.00" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className={`${inputCls} text-start`} />
            </Field>
            <Field label={t("catalogue.bottleMl")} htmlFor="n-ml">
              <select id="n-ml" value={f.bottleMl} onChange={(e) => setF({ ...f, bottleMl: e.target.value })} className={inputCls}>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </Field>
            <Field label={t("catalogue.packSize")} htmlFor="n-pack">
              <select id="n-pack" value={f.bottlesPerPack} onChange={(e) => setF({ ...f, bottlesPerPack: e.target.value })} className={inputCls}>{PACKS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </Field>
            <Field label={t("catalogue.minQty")} htmlFor="n-min">
              <input id="n-min" dir="ltr" inputMode="numeric" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value.replace(/\D/g, "") })} className={`${inputCls} text-start`} />
            </Field>
            <Field label={t("catalogue.stock")} htmlFor="n-stock">
              <select id="n-stock" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value as OfferRow["stock"] })} className={inputCls}>
                <option value="IN_STOCK">{t("catalogue.stockIn")}</option>
                <option value="LIMITED">{t("catalogue.stockLimited")}</option>
                <option value="OUT">{t("catalogue.stockOut")}</option>
              </select>
            </Field>
            <div className="sm:col-span-2"><Calculator priceHalalas={priceH} packetEqMilli={eq} feePerPacket={feePerPacket} /></div>
            {err && !err.field ? <div className="sm:col-span-2"><Banner tone="bad" role="alert">{err.msg}</Banner></div> : null}
            <div className="sm:col-span-2"><button type="submit" className={btnCls("primary")} disabled={busy}>{busy ? t("common.loading") : t("catalogue.addOffer")}</button></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
