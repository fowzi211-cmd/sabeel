import { z } from "zod";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseJson, route } from "@/lib/http";
import { checkTotp } from "@/lib/totp";

const schema = z.object({ token: z.string().regex(/^\s*\d{3}\s?\d{3}\s*$/, "Enter the 6-digit code") });
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export const POST = route({ allowMfaPending: true }, async ({ req, current, meta }) => {
  const { token } = await parseJson(req, schema);
  const { user, session } = current;

  // A stolen SMS-verified session must not be able to brute-force the authenticator code.
  // Failures count from the last successful verification (or the last 15 minutes, whichever is later).
  const lastOk = await db.auditLog.findFirst({
    where: { action: "auth.totp_verified", entityId: user.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = new Date(Math.max(Date.now() - WINDOW_MS, lastOk?.createdAt.getTime() ?? 0));
  const failures = await db.auditLog.count({
    where: { action: "auth.totp_failed", entityId: user.id, createdAt: { gte: since } },
  });
  if (failures >= MAX_FAILURES) throw new AppError("RATE_LIMITED");

  try {
    await checkTotp(user.id, token);
  } catch (e) {
    if (e instanceof AppError && e.code === "TOTP_INVALID") {
      await audit({ actor: user, action: "auth.totp_failed", entity: "User", entityId: user.id, meta });
    }
    throw e;
  }
  await db.session.update({ where: { id: session.id }, data: { mfaVerifiedAt: new Date() } });
  await audit({ actor: user, action: "auth.totp_verified", entity: "User", entityId: user.id, meta });
  return { ok: true };
});
