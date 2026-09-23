import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "./env";

export const sha256Hex = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

export const hmacHex = (message: string): string =>
  createHmac("sha256", getEnv().OTP_PEPPER).update(message).digest("hex");

/** URL-safe random token, e.g. for session cookies. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** Constant-time comparison of two hex/utf8 strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const key = () => Buffer.from(getEnv().DATA_KEY, "base64");

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptField(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
