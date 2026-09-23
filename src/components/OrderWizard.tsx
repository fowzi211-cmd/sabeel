"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { dayKey, fmtDay, fmtSlot, fmtWhen } from "@/lib/format";
import { insideMakkah, MAKKAH_CENTER } from "@/lib/geo";
import { formatSar } from "@/lib/money";
import { normalizeSaudiMobile } from "@/lib/validate";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, btnCls, inputCls } from "./ui";

const MapPicker = dynamic(() => import("./MapPicker").then((m) => m.MapPicker), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse rounded-xl bg-aqua-100" />,
});

interface District { id: string; slug: string; nameAr: string; nameEn: string; restricted: boolean; restrictedReason: string | null; restrictedReasonEn: string | null }
interface Brand { id: string; nameAr: string; nameEn: string }
interface SiteRow {
  id: string; label: string; districtId: string; district: { id: string; nameAr: string; nameEn: string };
  lat: number; lng: number; nationalAddress: string | null; landmark: string | null; accessNotes: string | null;
  recipientName: string | null; recipientMobile: string | null;
}
interface Offer {
  offerId: string;
  supplier: { id: string; nameAr: string; nameEn: string; independent: boolean };
  brand: { id: string; nameAr: string; nameEn: string };
  bottleMl: number; bottlesPerPack: number; stock: "IN_STOCK" | "LIMITED"; qtyPacks: number;
  unitPriceHalalas: number; goodsHalalas: number; deliveryHalalas: number; totalHalalas: number; vatHalalas: number;
  leadTimeHours: number; earliestSlot: string; rating: number | null; reviewCount: number;
}
interface Slot { start: string; end: string }

const SIZES = [200, 330, 500, 600, 1500];

interface Props {
  type: "DONATION" | "SELF_USE";
  hasName: boolean;
  termsAccepted: boolean;
  capHalalas: number;
}

export function OrderWizard({ type, hasName, termsAccepted, capHalalas }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const donation = type === "DONATION";
  const ready = hasName && termsAccepted;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [districts, setDistricts] = useState<District[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [site, setSite] = useState<SiteRow | null>(null);

  // new destination form
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ label: "", districtId: "", nationalAddress: "", landmark: "", accessNotes: "", recipientName: "", recipientMobile: "" });
  const [pin, setPin] = useState<{ lat: number; lng: number }>(MAKKAH_CENTER);
  const [locating, setLocating] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [siteBusy, setSiteBusy] = useState(false);

  // comparison
  const [qty, setQty] = useState("40");
  const [brandId, setBrandId] = useState("");
  const [bottleMl, setBottleMl] = useState("");
  const [hideIndependent, setHideIndependent] = useState(false);
  const [sort, setSort] = useState<"best" | "price" | "fastest">("best");
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [searching, setSearching] = useState(false);

  // review
  const [offer, setOffer] = useState<Offer | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const idemKey = useRef<string>(crypto.randomUUID());

  const [error, setError] = useState<string | null>(null);
  const errText = useCallback((e: unknown) => (e instanceof ApiError ? e.messageFor(locale) : t("common.error")), [locale, t]);
  const dName = (d: { nameAr: string; nameEn: string }) => (locale === "ar" ? d.nameAr : d.nameEn);
  const reasonOf = (d: District) => (locale === "ar" ? d.restrictedReason : d.restrictedReasonEn ?? d.restrictedReason) ?? "";

  // ───────── load reference data ─────────
  useEffect(() => {
    Promise.all([
      api<{ districts: District[] }>("/districts"),
      api<{ brands: Brand[] }>("/brands"),
      api<{ sites: SiteRow[] }>("/sites"),
    ])
      .then(([d, b, s]) => {
        setDistricts(d.districts);
        setBrands(b.brands);
        setSites(s.sites);
        setShowForm(s.sites.length === 0);
        setLoaded(true);
      })
      .catch((e) => setError(errText(e)));
  }, [errText]);

  // ───────── step 1: destinations ─────────
  function useMyLocation() {
    if (!navigator.geolocation) return setFormErrors((x) => ({ ...x, pin: t("order.locationDenied") }));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPin(next);
        setFormErrors((x) => ({ ...x, pin: insideMakkah(next.lat, next.lng) ? "" : t("order.outsideMakkah") }));
      },
      () => {
        setLocating(false);
        setFormErrors((x) => ({ ...x, pin: t("order.locationDenied") }));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function validateSite(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!f.label.trim()) e.label = t("errors.required");
    const d = districts.find((x) => x.id === f.districtId);
    if (!d) e.districtId = t("errors.required");
    else if (d.restricted) e.districtId = t("order.districtRestricted", { reason: reasonOf(d) });
    if (!insideMakkah(pin.lat, pin.lng)) e.pin = t("order.outsideMakkah");
    if (f.nationalAddress.trim() && !/^[A-Za-z]{4}\d{4}$/.test(f.nationalAddress.trim())) e.nationalAddress = t("order.nationalAddressHint");
    if (donation && !f.recipientName.trim()) e.recipientName = t("errors.required");
    if (donation && !normalizeSaudiMobile(f.recipientMobile)) e.recipientMobile = t("errors.mobile");
    if (!donation && f.recipientMobile.trim() && !normalizeSaudiMobile(f.recipientMobile)) e.recipientMobile = t("errors.mobile");
    return e;
  }

  async function saveSite() {
    setError(null);
    const v = validateSite();
    setFormErrors(v);
    if (Object.keys(v).some((k) => v[k])) return;
    setSiteBusy(true);
    try {
      const r = await api<{ site: SiteRow }>("/sites", {
        body: { label: f.label, districtId: f.districtId, lat: pin.lat, lng: pin.lng, nationalAddress: f.nationalAddress, landmark: f.landmark, accessNotes: f.accessNotes, recipientName: f.recipientName, recipientMobile: f.recipientMobile },
      });
      setSites((s) => [r.site, ...s]);
      chooseSite(r.site);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSiteBusy(false);
    }
  }

  async function removeSite(id: string) {
    try {
      await api(`/sites/${id}`, { method: "DELETE" });
      setSites((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setError(errText(e));
    }
  }

  function chooseSite(s: SiteRow) {
    setSite(s);
    setOffers(null);
    setOffer(null);
    setStep(2);
  }

  // ───────── step 2: search ─────────
  const qtyN = Number(qty);
  const qtyOk = Number.isInteger(qtyN) && qtyN >= 1 && qtyN <= 500;

  const runSearch = useCallback(async () => {
    if (!site || !qtyOk) return;
    setSearching(true);
    setError(null);
    try {
      const r = await api<{ offers: Offer[] }>("/offers/search", {
        body: { districtId: site.districtId, qtyPacks: qtyN, ...(brandId ? { brandId } : {}), ...(bottleMl ? { bottleMl: Number(bottleMl) } : {}), includeIndependent: !hideIndependent, sort },
      });
      setOffers(r.offers);
    } catch (e) {
      setOffers([]);
      setError(errText(e));
    } finally {
      setSearching(false);
    }
  }, [site, qtyOk, qtyN, brandId, bottleMl, hideIndependent, sort, errText]);

  useEffect(() => {
    if (step !== 2) return;
    const id = setTimeout(runSearch, 350); // debounce quantity typing
    return () => clearTimeout(id);
  }, [step, runSearch]);

  // ───────── step 3: review ─────────
  async function chooseOffer(o: Offer) {
    setError(null);
    setOffer(o);
    setSlotStart(null);
    setSlots([]);
    setStep(3);
    try {
      const r = await api<{ slots: Slot[] }>(`/offers/${o.offerId}/slots?districtId=${site!.districtId}`);
      setSlots(r.slots);
      if (r.slots[0]) setSlotStart(r.slots[0].start);
    } catch (e) {
      setError(errText(e));
    }
  }

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = dayKey(s.start);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.values()];
  }, [slots]);

  async function place() {
    if (!site || !offer || !slotStart) return;
    setPlacing(true);
    setError(null);
    try {
      const r = await api<{ order: { id: string } }>("/orders", {
        body: { siteId: site.id, type, anonymous: donation && anonymous, windowStart: slotStart, lines: [{ offerId: offer.offerId, qtyPacks: offer.qtyPacks }], note: note.trim() || undefined },
        // A retry of the same click returns the same order instead of a duplicate.
        headers: { "Idempotency-Key": idemKey.current },
      });
      router.push(`/orders/${r.order.id}`);
      router.refresh();
    } catch (e) {
      setError(errText(e));
      setPlacing(false);
    }
  }

  const stepper = (
    <ol className="mb-5 flex items-center gap-2 text-sm" aria-label="Steps">
      {[1, 2, 3].map((n) => (
        <li key={n} className="flex flex-1 items-center gap-2">
          <span className={`grid size-7 shrink-0 place-items-center rounded-full font-bold ${step >= n ? "bg-aqua-600 text-white" : "bg-[#E6EEF1] text-muted"}`}>{n}</span>
          <span className={`hidden sm:inline ${step === n ? "font-semibold text-ink" : "text-muted"}`}>{t(`order.step${n}`)}</span>
          {n < 3 ? <span className="h-0.5 flex-1 bg-line" /> : null}
        </li>
      ))}
    </ol>
  );

  if (!loaded && !error) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">{donation ? t("order.typeDonation") : t("order.typeSelf")}</h1>
      <p className="mb-4 text-sm text-muted">
        <Link className="font-semibold text-aqua-700 underline" href={donation ? "/order?type=self" : "/order"}>
          {donation ? t("order.typeSelf") : t("order.typeDonation")}
        </Link>
      </p>
      {stepper}
      {!hasName ? <div className="mb-3"><Banner tone="warn">{t("order.nameNeeded")} <Link className="font-semibold underline" href="/account?next=%2Forder">{t("order.goAccount")}</Link></Banner></div> : null}
      {hasName && !termsAccepted ? <div className="mb-3"><Banner tone="warn">{t("order.termsNeeded")} <Link className="font-semibold underline" href="/account?next=%2Forder">{t("order.goAccount")}</Link></Banner></div> : null}
      {error ? <div className="mb-3"><Banner tone="bad" role="alert">{error}</Banner></div> : null}

      {/* ─────────────── STEP 1 ─────────────── */}
      {step === 1 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{t("order.destTitle")}</h2>

          {sites.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-muted">{t("order.savedSites")}</p>
              {sites.map((s) => (
                <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{s.label}</div>
                    <div className="text-sm text-muted">{dName(s.district)}{s.recipientName ? ` · ${s.recipientName}` : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnCls("primary", "!min-h-9 !py-1.5 text-sm")} disabled={!ready || (donation && !s.recipientName)} onClick={() => chooseSite(s)}>{t("order.useSite")}</button>
                    <button type="button" className={btnCls("ghost", "!min-h-9 !py-1.5 text-sm")} onClick={() => removeSite(s.id)}>{t("order.deleteSite")}</button>
                  </div>
                </Card>
              ))}
              {!showForm ? <button type="button" className={btnCls("secondary")} onClick={() => setShowForm(true)}>＋ {t("order.newSite")}</button> : null}
            </div>
          ) : null}

          {showForm ? (
            <Card className="space-y-4">
              <h3 className="font-bold">{t("order.newSite")}</h3>
              <MapPicker value={pin} onChange={(p) => { setPin(p); setFormErrors((x) => ({ ...x, pin: insideMakkah(p.lat, p.lng) ? "" : t("order.outsideMakkah") })); }} label={t("order.pinHelp")} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")} onClick={useMyLocation} disabled={locating}>📍 {locating ? t("order.locating") : t("order.useMyLocation")}</button>
                <span className="text-xs text-muted">{t("order.pinHelp")}</span>
              </div>
              {formErrors.pin ? <p role="alert" className="text-xs font-medium text-bad">{formErrors.pin}</p> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("order.siteLabel")} htmlFor="s-label" hint={t("order.siteLabelHint")} error={formErrors.label}>
                  <input id="s-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t("order.district")} htmlFor="s-district" error={formErrors.districtId}>
                  <select id="s-district" value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value })} className={inputCls}>
                    <option value="">{t("order.districtChoose")}</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id} disabled={d.restricted}>{dName(d)}{d.restricted ? ` — ${t("order.districtRestricted", { reason: reasonOf(d) })}` : ""}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t("order.nationalAddress")} htmlFor="s-na" hint={t("order.nationalAddressHint")} error={formErrors.nationalAddress}>
                  <input id="s-na" dir="ltr" value={f.nationalAddress} onChange={(e) => setF({ ...f, nationalAddress: e.target.value.toUpperCase() })} maxLength={8} className={`${inputCls} text-start font-mono`} />
                </Field>
                <Field label={t("order.landmark")} htmlFor="s-landmark">
                  <input id="s-landmark" value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} className={inputCls} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t("order.accessNotes")} htmlFor="s-notes">
                    <input id="s-notes" value={f.accessNotes} onChange={(e) => setF({ ...f, accessNotes: e.target.value })} className={inputCls} />
                  </Field>
                </div>
              </div>

              <div className="rounded-xl bg-page p-3">
                <p className="mb-2 text-sm font-semibold">{donation ? t("order.recipientDonation") : t("order.recipientSelf")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("order.recipientName")} htmlFor="s-rname" error={formErrors.recipientName}>
                    <input id="s-rname" value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t("order.recipientMobile")} htmlFor="s-rmobile" error={formErrors.recipientMobile}>
                    <input id="s-rmobile" type="tel" dir="ltr" value={f.recipientMobile} onChange={(e) => setF({ ...f, recipientMobile: e.target.value })} className={`${inputCls} text-start`} placeholder="05xxxxxxxx" />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted">{t("order.recipientNote")}</p>
              </div>

              <div className="flex gap-2">
                <button type="button" className={btnCls("primary")} disabled={siteBusy || !ready} onClick={saveSite}>{siteBusy ? t("common.loading") : t("order.saveSite")}</button>
                {sites.length > 0 ? <button type="button" className={btnCls("ghost")} onClick={() => setShowForm(false)}>{t("common.cancel")}</button> : null}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* ─────────────── STEP 2 ─────────────── */}
      {step === 2 && site ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{t("order.compareTitle")}</h2>
            <button type="button" className="text-sm font-semibold text-aqua-700 underline" onClick={() => setStep(1)}>{t("order.forSite", { site: `${site.label} · ${dName(site.district)}` })} — {t("order.change")}</button>
          </div>

          <Card className="grid gap-3 sm:grid-cols-4">
            <Field label={t("order.qty")} htmlFor="q-qty" hint={t("order.qtyHelp")} error={qtyOk ? null : t("errors.required")}>
              <input id="q-qty" inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} className={`${inputCls} text-start`} />
            </Field>
            <Field label={t("order.brand")} htmlFor="q-brand">
              <select id="q-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className={inputCls}>
                <option value="">{t("order.allBrands")}</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{dName(b)}</option>)}
              </select>
            </Field>
            <Field label={t("order.size")} htmlFor="q-size">
              <select id="q-size" value={bottleMl} onChange={(e) => setBottleMl(e.target.value)} className={inputCls}>
                <option value="">{t("order.allSizes")}</option>
                {SIZES.map((s) => <option key={s} value={s}>{s} {locale === "ar" ? "مل" : "ml"}</option>)}
              </select>
            </Field>
            <Field label={t("order.sort")} htmlFor="q-sort">
              <select id="q-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={inputCls}>
                <option value="best">{t("order.sortBest")}</option>
                <option value="price">{t("order.sortPrice")}</option>
                <option value="fastest">{t("order.sortFastest")}</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-4">
              <input type="checkbox" className="size-4 accent-aqua-600" checked={hideIndependent} onChange={(e) => setHideIndependent(e.target.checked)} />
              {t("order.hideIndependent")}
            </label>
          </Card>

          <Banner tone="info">{t("order.feeNever")}</Banner>

          {searching && offers === null ? <p className="text-muted">{t("common.loading")}</p> : null}
          {offers && offers.length === 0 ? <Banner tone="warn">{t("order.noResults")}</Banner> : null}
          {offers && offers.length > 0 ? <p className="text-sm text-muted" aria-live="polite">{t("order.results", { n: offers.length })}</p> : null}

          <div className="space-y-3" aria-busy={searching}>
            {offers?.map((o, i) => (
              <Card key={o.offerId} className={i === 0 && sort === "best" ? "!border-aqua-600 ring-2 ring-aqua-100" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{dName(o.supplier)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip tone="ok">✔ {t("order.verified")}</Chip>
                      {o.supplier.independent ? <Chip tone="neutral">🚚 {t("order.independent")}</Chip> : null}
                      {o.rating !== null ? (
                        <Chip tone="neutral">★ {o.rating.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US")} <span className="text-muted">({o.reviewCount})</span></Chip>
                      ) : (
                        <Chip tone="neutral">☆ {t("order.isNew")}</Chip>
                      )}
                      {o.stock === "LIMITED" ? <Chip tone="warn">{t("order.limited")}</Chip> : null}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-2xl font-bold">{formatSar(o.totalHalalas, locale)}</div>
                    <div className="text-xs text-muted">{t("order.vatNote", { vat: formatSar(o.vatHalalas, locale) })}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{dName(o.brand)} <Chip tone="info">{t("order.registeredBrand")}</Chip></span>
                  <span className="text-muted">{t("orders.packLine", { ml: o.bottleMl, n: o.bottlesPerPack })}</span>
                  <span className="text-muted">{formatSar(o.unitPriceHalalas, locale)} × {o.qtyPacks}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted">⏱ {t("order.earliest", { when: fmtWhen(o.earliestSlot, locale) })}</span>
                  <button type="button" className={btnCls(i === 0 ? "primary" : "secondary", "!min-h-10")} disabled={!ready} onClick={() => chooseOffer(o)}>{t("order.select")}</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─────────────── STEP 3 ─────────────── */}
      {step === 3 && site && offer ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{t("order.reviewTitle")}</h2>
            <button type="button" className="text-sm font-semibold text-aqua-700 underline" onClick={() => setStep(2)}>{t("order.change")}</button>
          </div>

          <Card>
            <div className="font-bold">{dName(offer.supplier)}</div>
            <div className="text-sm text-muted">{dName(offer.brand)} · {t("orders.packLine", { ml: offer.bottleMl, n: offer.bottlesPerPack })} · {t("orders.packs", { qty: offer.qtyPacks })}</div>
            <div className="mt-2 text-sm">📍 {site.label} · {dName(site.district)}</div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">{t("order.chooseWindow")}</h3>
            {slots.length === 0 ? <p className="text-muted">{t("order.noSlots")}</p> : (
              <div className="space-y-3">
                {slotsByDay.map((day) => (
                  <div key={day[0].start}>
                    <p className="mb-1 text-sm font-semibold text-muted">{fmtDay(day[0].start, locale)}</p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("order.chooseWindow")}>
                      {day.map((s) => {
                        const on = slotStart === s.start;
                        return (
                          <button key={s.start} type="button" role="radio" aria-checked={on} onClick={() => setSlotStart(s.start)}
                            className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold ${on ? "border-aqua-600 bg-aqua-600 text-white" : "border-line bg-white text-ink hover:border-aqua-500"}`}>
                            {fmtSlot(s.start, s.end, locale).split(" · ")[1]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {donation ? (
            <Card>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1.5 size-4 accent-aqua-600" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                <span><span className="font-semibold">{t("order.anonymous")}</span><span className="block text-sm text-muted">{t("order.anonymousHelp")}</span></span>
              </label>
            </Card>
          ) : null}

          <Field label={t("order.noteLabel")} htmlFor="o-note">
            <textarea id="o-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} min-h-16`} />
          </Field>

          <Card>
            <div className="space-y-1.5 text-[15px]">
              <div className="flex justify-between"><span>{t("order.goods", { qty: offer.qtyPacks, price: formatSar(offer.unitPriceHalalas, locale) })}</span><span>{formatSar(offer.goodsHalalas, locale)}</span></div>
              <div className="flex justify-between"><span>{t("order.delivery")}</span><span>{formatSar(offer.deliveryHalalas, locale)}</span></div>
              <div className="flex justify-between text-xs text-muted"><span>{t("order.vatIncl")}</span><span>{formatSar(offer.vatHalalas, locale)}</span></div>
              <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><span>{t("order.total")}</span><span>{formatSar(offer.totalHalalas, locale)}</span></div>
            </div>
          </Card>

          <Banner tone="ok">{t("order.noChargeNow")}</Banner>
          <Banner tone="warn">{t("order.limitNote", { cap: formatSar(capHalalas, locale) })}</Banner>

          <button type="button" className={btnCls("primary", "w-full")} disabled={placing || !ready || !slotStart} onClick={place}>
            {placing ? t("order.placing") : t("order.place")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
