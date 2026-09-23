import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { checkTotp } from "@/lib/totp";

const schema = z.object({ token: z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/, "Enter the 6-digit code") });

export const POST = route({ allowMfaPending: true }, async ({ req, current, meta }) => {
  const { token } = await parseJson(req, schema);
  const { user, session } = current;
  if (user.totpEnabledAt) throw new AppError("CONFLICT", { message: "Two-step verification is already enabled" });

  await checkTotp(user.id, token, { enable: true });
  await db.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date() } });
  await audit({ actor: user, action: "auth.totp_enabled", entity: "User", entityId: user.id, meta });
  return { ok: true };
});
