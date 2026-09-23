// Display helpers shared by server and client components. Times are always shown in Riyadh time and
// the Gregorian calendar with Western digits, whatever the visitor's device says.

const TZ = "Asia/Riyadh";
const loc = (l: "ar" | "en") => (l === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");

const hm = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** "Sunday, 21 Sep · 08:00–11:00" */
export function fmtSlot(startIso: string | Date, endIso: string | Date, locale: "ar" | "en"): string {
  const day = new Intl.DateTimeFormat(loc(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }).format(new Date(startIso));
  return `${day} · ${hm(startIso)}–${hm(endIso)}`;
}

/** "Sunday, 21 Sep, 08:00" */
export function fmtWhen(iso: string | Date, locale: "ar" | "en"): string {
  const day = new Intl.DateTimeFormat(loc(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }).format(new Date(iso));
  return `${day}, ${hm(iso)}`;
}

/** Riyadh calendar day as "YYYY-MM-DD" — used to group delivery windows by day. */
export const dayKey = (iso: string | Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** "Sunday, 21 Sep" heading for a day group. */
export const fmtDay = (iso: string | Date, locale: "ar" | "en"): string =>
  new Intl.DateTimeFormat(loc(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));

export const pctOf = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
