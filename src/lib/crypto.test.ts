import { describe, expect, it } from "vitest";
import { decryptField, encryptField, hmacHex, safeEqual, sha256Hex } from "./crypto";
import { normalizeBody, termsHash } from "@/server/terms";

describe("field encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptField("1000000008");
    const b = encryptField("1000000008");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("1000000008");
    expect(decryptField(b)).toBe("1000000008");
  });

  it("rejects tampered ciphertext", () => {
    const enc = Buffer.from(encryptField("secret"), "base64");
    enc[enc.length - 1] ^= 0xff;
    expect(() => decryptField(enc.toString("base64"))).toThrow();
  });
});

describe("hashing helpers", () => {
  it("sha256 is deterministic", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hmac depends on the message", () => {
    expect(hmacHex("a")).not.toBe(hmacHex("b"));
    expect(hmacHex("a")).toBe(hmacHex("a"));
  });
  it("safeEqual handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("agreement fingerprint", () => {
  it("ignores line-ending and outer-whitespace differences", () => {
    expect(termsHash("a\r\nb\r\n")).toBe(termsHash("a\nb"));
    expect(normalizeBody("  x \r\n y ")).toBe("x \n y");
  });
  it("changes when a single character changes", () => {
    expect(termsHash("fee is 0.50")).not.toBe(termsHash("fee is 0.51"));
  });
});
