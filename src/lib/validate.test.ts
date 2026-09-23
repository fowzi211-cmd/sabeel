import { describe, expect, it } from "vitest";
import {
  hasArabic,
  isValidCrNumber,
  isValidFreelanceNumber,
  isValidSaudiIban,
  isValidSaudiIdNumber,
  isValidVatNumber,
  normalizeIban,
  normalizeSaudiMobile,
} from "./validate";

describe("normalizeSaudiMobile", () => {
  it.each([
    ["0512345678", "+966512345678"],
    ["512345678", "+966512345678"],
    ["966512345678", "+966512345678"],
    ["+966512345678", "+966512345678"],
    ["00966512345678", "+966512345678"],
    ["+966 51 234 5678", "+966512345678"],
    ["05-1234-5678", "+966512345678"],
    ["٠٥١٢٣٤٥٦٧٨", "+966512345678"], // Arabic-Indic digits
    ["۰۵۱۲۳۴۵۶۷۸", "+966512345678"], // Persian digits
  ])("accepts %s", (input, expected) => {
    expect(normalizeSaudiMobile(input)).toBe(expected);
  });

  it.each(["", "0412345678", "051234567", "05123456789", "+971512345678", "abc", "+9664123456789"])(
    "rejects %s",
    (input) => {
      expect(normalizeSaudiMobile(input)).toBeNull();
    },
  );
});

describe("Saudi IBAN", () => {
  // Computed with the ISO 7064 mod-97 rule for SA + 2 check digits + 22 digits.
  const valid = "SA0380000000608010167519";

  it("accepts a correct IBAN, with spaces and lowercase", () => {
    expect(isValidSaudiIban(valid)).toBe(true);
    expect(isValidSaudiIban("sa03 8000 0000 6080 1016 7519")).toBe(true);
    expect(normalizeIban("sa03 8000 0000 6080 1016 7519")).toBe(valid);
  });

  it("rejects a wrong check digit, wrong length or non-Saudi country", () => {
    expect(isValidSaudiIban("SA0480000000608010167519")).toBe(false);
    expect(isValidSaudiIban("SA038000000060801016751")).toBe(false);
    expect(isValidSaudiIban("AE070331234567890123456")).toBe(false);
    expect(isValidSaudiIban("")).toBe(false);
  });
});

describe("registration numbers", () => {
  it("CR is exactly 10 digits", () => {
    expect(isValidCrNumber("1010123456")).toBe(true);
    expect(isValidCrNumber("١٠١٠١٢٣٤٥٦")).toBe(true);
    expect(isValidCrNumber("101012345")).toBe(false);
    expect(isValidCrNumber("10101234567")).toBe(false);
    expect(isValidCrNumber("10101234ab")).toBe(false);
  });

  it("VAT is 15 digits starting and ending with 3", () => {
    expect(isValidVatNumber("300000000000003")).toBe(true);
    expect(isValidVatNumber("310122393500003")).toBe(true);
    expect(isValidVatNumber("400000000000003")).toBe(false);
    expect(isValidVatNumber("300000000000004")).toBe(false);
    expect(isValidVatNumber("30000000000003")).toBe(false);
  });

  it("freelance document numbers are conservative alphanumerics", () => {
    expect(isValidFreelanceNumber("FL-123456")).toBe(true);
    expect(isValidFreelanceNumber("123")).toBe(false);
    expect(isValidFreelanceNumber("bad number!")).toBe(false);
  });
});

describe("Saudi National ID / Iqama (Luhn)", () => {
  it("accepts numbers that pass the checksum", () => {
    expect(isValidSaudiIdNumber("1000000008")).toBe(true);
    expect(isValidSaudiIdNumber("2000000006")).toBe(true);
  });
  it("rejects wrong checksum, wrong prefix or wrong length", () => {
    expect(isValidSaudiIdNumber("1000000009")).toBe(false);
    expect(isValidSaudiIdNumber("3000000000")).toBe(false);
    expect(isValidSaudiIdNumber("100000000")).toBe(false);
  });
});

describe("hasArabic", () => {
  it("detects Arabic letters", () => {
    expect(hasArabic("شركة سحاب")).toBe(true);
    expect(hasArabic("Sahab Water")).toBe(false);
    expect(hasArabic("Sahab سحاب")).toBe(true);
  });
});
