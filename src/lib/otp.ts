import { randomInt, randomUUID } from "node:crypto";
import type { Lang, OtpPurpose } from "@prisma/client";
import { db } from "./db";
import { hmacHex, safeEqual } from "./crypto";
import { devOtpEchoAllowed } from "./env";
import { AppError } from "./errors";
import { sendSms } from "./sms";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
const MAX_PER_MOBILE_PER_HOUR = 5;
// Per-address cap is generous on purpose: mobile carriers put many real users behind one address.
// The tight limits are per mobile number (5/hour) and per code (5 guesses).
const MAX_PER_IP_PER_HOUR = 60;
const HOUR = 3_600_000;

const codeHash = (challengeId: string, code: string) => hmacHex(`otp:${challengeId}:${code}`);

function message(lang: Lang, code: string, purpose: OtpPurpose): string {
  if (purpose === "DELIVERY") {
    return lang === "EN"
      ? `Sabeel: your water delivery code is ${code}. Give it to the driver ONLY when the water has arrived.`
      : `سبيل: رمز استلام المياه ${code}. أعطه للسائق فقط بعد وصول المياه إليك.`;
  }
  if (lang === "EN") {
    return purpose === "SIGN"
      ? `Sabeel: code ${code} to sign your agreement. Valid 5 minutes. Never share it.`
      : `Sabeel: your sign-in code is ${code}. Valid 5 minutes. Never share it.`;
  }
  return purpose === "SIGN"
    ? `سبيل: رمز توقيع الاتفاقية ${code}. صالح 5 دقائق. لا تشاركه مع أحد.`
    : `سبيل: رمز الدخول ${code}. صالح 5 دقائق. لا تشاركه مع أحد.`;
}

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
  cooldownSeconds: number;
  /** Only ever set when the console SMS provider is active outside production. */
  devCode?: string;
}

export async function requestOtp(input: {
  mobile: string;
  purpose: OtpPurpose;
  context?: string;
  userId?: string | null;
  lang?: Lang;
  ip?: string | null;
}): Promise<OtpRequestResult> {
  const now = Date.now();

  const [recentForMobile, recentForIp, last] = await Promise.all([
    db.otpChallenge.count({ where: { mobile: input.mobile, createdAt: { gte: new Date(now - HOUR) } } }),
    input.ip
      ? db.otpChallenge.count({ where: { ip: input.ip, createdAt: { gte: new Date(now - HOUR) } } })
      : Promise.resolve(0),
    db.otpChallenge.findFirst({
      where: { mobile: input.mobile, purpose: input.purpose },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  if (recentForMobile >= MAX_PER_MOBILE_PER_HOUR || recentForIp >= MAX_PER_IP_PER_HOUR) {
    throw new AppError("RATE_LIMITED");
  }
  if (last && now - last.createdAt.getTime() < OTP_COOLDOWN_MS) {
    throw new AppError("OTP_COOLDOWN", {
      details: { retryAfterSeconds: Math.ceil((OTP_COOLDOWN_MS - (now - last.createdAt.getTime())) / 1000) },
    });
  }

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now + OTP_TTL_MS);

  await db.otpChallenge.create({
    data: {
      id,
      mobile: input.mobile,
      purpose: input.purpose,
      context: input.context ?? null,
      userId: input.userId ?? null,
      codeHash: codeHash(id, code),
      expiresAt,
      ip: input.ip ?? null,
    },
  });

  try {
    await sendSms({
      to: input.mobile,
      text: message(input.lang ?? "AR", code, input.purpose),
      logText: `[one-time code — not stored] purpose=${input.purpose}`,
      event: `otp.${input.purpose.toLowerCase()}`,
      userId: input.userId,
    });
  } catch (err) {
    // A code that could not be delivered must not count against the user.
    await db.otpChallenge.delete({ where: { id } }).catch(() => undefined);
    throw err;
  }

  return {
    challengeId: id,
    expiresAt,
    cooldownSeconds: OTP_COOLDOWN_MS / 1000,
    ...(devOtpEchoAllowed() ? { devCode: code } : {}),
  };
}

/**
 * Verifies the newest live challenge for this mobile + purpose (+ context).
 * Wrong guesses are counted atomically; after `maxAttempts` the challenge is dead.
 */
export async function verifyOtp(input: {
  mobile: string;
  purpose: OtpPurpose;
  code: string;
  context?: string;
}): Promise<{ challengeId: string }> {
  const challenge = await db.otpChallenge.findFirst({
    where: {
      mobile: input.mobile,
      purpose: input.purpose,
      ...(input.context !== undefined ? { context: input.context } : {}),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new AppError("OTP_INVALID");

  // Reserve an attempt first; concurrent guesses cannot exceed the cap.
  const reserved = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) throw new AppError("OTP_LOCKED");

  const supplied = codeHash(challenge.id, input.code.trim());
  if (!safeEqual(supplied, challenge.codeHash)) {
    if (challenge.attempts + 1 >= challenge.maxAttempts) throw new AppError("OTP_LOCKED");
    throw new AppError("OTP_INVALID");
  }

  // Single use: only one caller can flip consumedAt from null.
  const consumed = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) throw new AppError("OTP_INVALID");

  return { challengeId: challenge.id };
}
