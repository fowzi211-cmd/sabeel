import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { db } from "./db";
import { decryptField, encryptField } from "./crypto";
import { AppError } from "./errors";

const PERIOD = 30;

function build(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "Sabeel",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export async function beginTotpSetup(userId: string, mobile: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const base32 = secret.base32;
  // Stored encrypted but not enabled until the user proves they can produce a code.
  await db.user.update({
    where: { id: userId },
    data: { totpSecretEnc: encryptField(base32), totpEnabledAt: null, totpLastStep: null },
  });
  const uri = build(base32, mobile).toString();
  return { otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), secretBase32: base32 };
}

/** Validates a code and rejects replays of a step that was already accepted. */
export async function checkTotp(userId: string, token: string, opts: { enable?: boolean } = {}): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mobile: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true },
  });
  if (!user?.totpSecretEnc) throw new AppError("TOTP_INVALID");
  if (!opts.enable && !user.totpEnabledAt) throw new AppError("TOTP_INVALID");

  const totp = build(decryptField(user.totpSecretEnc), user.mobile);
  const delta = totp.validate({ token: token.replace(/\s+/g, ""), window: 1 });
  if (delta === null) throw new AppError("TOTP_INVALID");

  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  if (user.totpLastStep !== null && step <= user.totpLastStep) throw new AppError("TOTP_INVALID");

  // Conditional update makes the "one use per step" rule race-free.
  const updated = await db.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step, ...(opts.enable ? { totpEnabledAt: new Date() } : {}) },
  });
  if (updated.count === 0) throw new AppError("TOTP_INVALID");
}
