import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { requestOtp } from "@/lib/otp";
import { normalizeSaudiMobile } from "@/lib/validate";

const schema = z.object({
  mobile: z.string().min(1),
  lang: z.enum(["AR", "EN"]).default("AR"),
});

export const POST = route({ auth: "none" }, async ({ req, meta }) => {
  const body = await parseJson(req, schema);
  const mobile = normalizeSaudiMobile(body.mobile);
  if (!mobile) throw new AppError("MOBILE_INVALID", { field: "mobile" });

  const existing = await db.user.findUnique({ where: { mobile }, select: { id: true, status: true, language: true } });
  if (existing && existing.status !== "ACTIVE") throw new AppError("ACCOUNT_BLOCKED");

  const result = await requestOtp({
    mobile,
    purpose: "LOGIN",
    userId: existing?.id,
    lang: existing?.language ?? body.lang,
    ip: meta.ip,
  });
  return {
    ok: true,
    mobile,
    expiresAt: result.expiresAt,
    cooldownSeconds: result.cooldownSeconds,
    ...(result.devCode ? { devCode: result.devCode } : {}),
  };
});
