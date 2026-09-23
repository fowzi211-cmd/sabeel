import type { Lang, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendSms } from "@/lib/sms";

export interface Bilingual {
  ar: string;
  en: string;
}

/**
 * In-app notification (always) + SMS (unless `sms: false`) to one user, in their language.
 * A failed SMS must never fail the business action that triggered it, so errors are logged and swallowed.
 */
export async function notifyUser(
  user: { id: string; mobile: string; language: Lang },
  event: string,
  text: Bilingual,
  payload: Prisma.InputJsonValue,
  opts: { sms?: boolean } = {},
): Promise<void> {
  const body = user.language === "EN" ? text.en : text.ar;
  try {
    await db.notification.create({
      data: { userId: user.id, channel: "IN_APP", event, payload: { ...(payload as object), text: body }, status: "SENT", sentAt: new Date() },
    });
    if (opts.sms !== false) await sendSms({ to: user.mobile, text: body, event, userId: user.id });
  } catch (e) {
    console.error(`[notify] ${event} failed`, e);
  }
}

export async function notifyUserId(userId: string, event: string, text: Bilingual, payload: Prisma.InputJsonValue, opts: { sms?: boolean } = {}) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, mobile: true, language: true } });
  if (user) await notifyUser(user, event, text, payload, opts);
}

/** Every owner of a supplier account. */
export async function notifySupplier(supplierId: string, event: string, text: Bilingual, payload: Prisma.InputJsonValue, opts: { sms?: boolean } = {}) {
  const owners = await db.supplierMember.findMany({ where: { supplierId, role: "OWNER" }, include: { user: { select: { id: true, mobile: true, language: true } } } });
  for (const { user } of owners) await notifyUser(user, event, text, payload, opts);
}
