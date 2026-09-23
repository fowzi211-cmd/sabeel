import { db } from "./db";
import { getEnv, isProduction } from "./env";
import { AppError } from "./errors";

export interface SmsMessage {
  to: string;
  text: string;
  event: string;
  userId?: string | null;
  /** What may be written to the notification log. One-time codes must never be stored. */
  logText?: string;
}

/**
 * Provider adapter. Only "console" exists today; it is refused in production so the platform
 * can never silently pretend to send SMS. A real Saudi SMS provider adapter (Unifonic,
 * Taqnyat, ...) is added here once the owner has an account and sender ID.
 */
export async function sendSms(msg: SmsMessage): Promise<void> {
  const provider = getEnv().SMS_PROVIDER;

  if (provider === "console") {
    if (isProduction()) {
      throw new AppError("SMS_UNAVAILABLE", {
        message: "SMS_PROVIDER=console is not allowed when NODE_ENV=production",
      });
    }
    console.log(`[sms:console] to=${msg.to} :: ${msg.text}`);
    await db.notification.create({
      data: {
        userId: msg.userId ?? null,
        mobile: msg.to,
        channel: "SMS",
        event: msg.event,
        payload: { text: msg.logText ?? msg.text },
        status: "SENT",
        provider: "console",
        sentAt: new Date(),
      },
    });
    return;
  }

  throw new AppError("SMS_UNAVAILABLE");
}
