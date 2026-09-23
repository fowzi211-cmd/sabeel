// Pure validators for Saudi-specific identifiers. No I/O here so they are trivially testable.

/**
 * Normalizes a Saudi mobile number to +9665XXXXXXXX.
 * Accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX and 009665XXXXXXXX,
 * with spaces, dashes or Arabic-Indic digits. Returns null when it is not a Saudi mobile.
 */
export function normalizeSaudiMobile(input: string): string | null {
  const digits = toWesternDigits(input).replace(/[\s\-().]/g, "");
  let core: string;
  if (/^\+9665\d{8}$/.test(digits)) core = digits.slice(4);
  else if (/^009665\d{8}$/.test(digits)) core = digits.slice(5);
  else if (/^9665\d{8}$/.test(digits)) core = digits.slice(3);
  else if (/^05\d{8}$/.test(digits)) core = digits.slice(1);
  else if (/^5\d{8}$/.test(digits)) core = digits;
  else return null;
  return `+966${core}`;
}

export function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** ISO 7064 mod-97 check over the rearranged IBAN. */
function ibanMod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function normalizeIban(input: string): string {
  return toWesternDigits(input).replace(/\s+/g, "").toUpperCase();
}

/** Saudi IBAN: "SA" + 2 check digits + 2-digit bank code + 18 digits = 24 characters. */
export function isValidSaudiIban(input: string): boolean {
  const iban = normalizeIban(input);
  return /^SA\d{22}$/.test(iban) && ibanMod97(iban);
}

/** Commercial Registration number: 10 digits. */
export const isValidCrNumber = (v: string) => /^\d{10}$/.test(toWesternDigits(v).trim());

/** Freelance / sole-trader document numbers vary; accept a conservative alphanumeric form. */
export const isValidFreelanceNumber = (v: string) =>
  /^[A-Za-z0-9\-/]{6,24}$/.test(toWesternDigits(v).trim());

/** ZATCA VAT registration number: 15 digits, starting and ending with 3. */
export const isValidVatNumber = (v: string) => /^3\d{13}3$/.test(toWesternDigits(v).trim());

/** Luhn check (used by the Saudi National ID / Iqama number: 10 digits starting with 1 or 2). */
export function isValidSaudiIdNumber(v: string): boolean {
  const id = toWesternDigits(v).trim();
  if (!/^[12]\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(id[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** True when the string contains at least one Arabic letter. */
export const hasArabic = (v: string) => /[؀-ۿ]/.test(v);
