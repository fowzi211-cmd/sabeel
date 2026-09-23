import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { verifyOtp } from "@/lib/otp";
import { createSession, isPrivileged, writeSessionCookie } from "@/lib/session";
import { normalizeSaudiMobile } from "@/lib/validate";
import { loginOrRegister, publicUser } from "@/server/users";

const schema = z.object({
  mobile: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  lang: z.enum(["AR", "EN"]).default("AR"),
});

export const POST = route({ auth: "none" }, async ({ req, meta }) => {
  const body = await parseJson(req, schema);
  const mobile = normalizeSaudiMobile(body.mobile);
  if (!mobile) throw new AppError("MOBILE_INVALID", { field: "mobile" });

  await verifyOtp({ mobile, purpose: "LOGIN", code: body.code });
  const { user, isNew } = await loginOrRegister(mobile, meta, body.lang);

  const { token, expiresAt } = await createSession(user.id, user.roles, meta);
  await writeSessionCookie(token, expiresAt);
  (await cookies()).set("sabeel_lang", user.language.toLowerCase(), { path: "/", sameSite: "lax", maxAge: 365 * 86_400 });

  // Privileged accounts must pass (or first set up) two-step verification before anything else.
  const next = isPrivileged(user.roles)
    ? user.totpEnabledAt
      ? "/2fa"
      : "/2fa?setup=1"
    : user.name
      ? user.roles.includes("DRIVER") && !user.roles.includes("BUYER")
        ? "/driver" // a driver-only account goes straight to the driver app
        : "/"
      : "/account";

  return { user: publicUser(user), isNew, next };
});
