import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { addPhoto, photoMetaSchema } from "@/server/driver";

/** One photo per request (multipart). Idempotent on `clientId`, so offline retries never duplicate evidence. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("PHOTO_INVALID");
  const raw = Object.fromEntries([...form.entries()].filter(([k]) => k !== "file").map(([k, v]) => [k, String(v)]));
  const parsed = photoMetaSchema.parse(raw);
  return addPhoto(current.user, params.id, parsed, file, meta);
});
