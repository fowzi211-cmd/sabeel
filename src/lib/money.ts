// Money is always an integer number of halalas (1 SAR = 100 halalas). Prices in the catalogue
// and delivery fees are VAT-inclusive; the platform fee is quoted without VAT (design pack R02/R03).

export const VAT_PERCENT = 15;
/** The unit the fee is defined on: 1 packet = 20 bottles. */
export const BOTTLES_PER_PACKET = 20;

/** VAT contained in a VAT-inclusive amount, rounded to the nearest halala. */
export const vatIncluded = (grossHalalas: number): number =>
  Math.round((grossHalalas * VAT_PERCENT) / (100 + VAT_PERCENT));

/**
 * Packet-equivalents in thousandths (20 bottles → 1000). A 24-bottle carton is 1200, a 12-bottle
 * carton 600. A single large jug (≥ 10 L) counts as one packet by default; admins can refine later.
 */
export function packetEqMilliFor(bottlesPerPack: number, bottleMl: number): number {
  if (bottlesPerPack === 1 && bottleMl >= 10_000) return 1000;
  return bottlesPerPack * (1000 / BOTTLES_PER_PACKET);
}

/** Platform fee for a quantity: packet-equivalents × rate, rounded once. */
export const feeHalalas = (packetEqMilli: number, qtyPacks: number, feePerPacketHalalas: number): number =>
  Math.round((packetEqMilli * qtyPacks * feePerPacketHalalas) / 1000);

export interface KeepBreakdown {
  fee: number;
  feeVat: number;
  keep: number;
}

/** What a supplier keeps out of an amount they receive from the buyer, after the platform fee and its VAT. */
export function supplierKeeps(receivedHalalas: number, fee: number): KeepBreakdown {
  const feeVat = Math.round((fee * VAT_PERCENT) / 100);
  return { fee, feeVat, keep: receivedHalalas - fee - feeVat };
}

/** "9.5" / "9,50" / "٩٫٥٠" → 950. Returns null for anything that is not a plain amount with ≤ 2 decimals. */
export function sarToHalalas(input: string | number): number | null {
  const s = String(input)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatSar(halalas: number, locale: "ar" | "en" = "en"): string {
  const n = (halalas / 100).toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return locale === "ar" ? `${n} ر.س` : `SAR ${n}`;
}
