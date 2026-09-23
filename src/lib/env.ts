import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url(),
  OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),
  // 32 random bytes, base64 encoded (see .env). Used for field-level AES-256-GCM.
  DATA_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "DATA_KEY must be 32 random bytes, base64 encoded",
  }),
  SMS_PROVIDER: z.enum(["console"]).default("console"),
  STORAGE_DIR: z.string().default("./storage/private"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated configuration. Read lazily so `next build` does not need secrets. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * The "console" SMS provider prints codes to the server log. It exists only so the
 * platform can be developed without an SMS account, so it must never run in production.
 */
export function devOtpEchoAllowed(): boolean {
  return !isProduction() && getEnv().SMS_PROVIDER === "console";
}
