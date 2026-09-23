import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { audit } from "@/lib/audit";
import { beginTotpSetup } from "@/lib/totp";
import { isPrivileged } from "@/lib/session";

export const POST = route({ allowMfaPending: true }, async ({ current, meta }) => {
  const { user } = current;
  if (!isPrivileged(user.roles)) throw new AppError("FORBIDDEN");
  // Re-enrolling would let a hijacked session replace the second factor; an admin must reset it instead.
  if (user.totpEnabledAt) throw new AppError("CONFLICT", { message: "Two-step verification is already enabled" });

  const setup = await beginTotpSetup(user.id, user.mobile);
  await audit({ actor: user, action: "auth.totp_setup_started", entity: "User", entityId: user.id, meta });
  return { qrDataUrl: setup.qrDataUrl, secretBase32: setup.secretBase32, otpauthUri: setup.otpauthUri };
});
