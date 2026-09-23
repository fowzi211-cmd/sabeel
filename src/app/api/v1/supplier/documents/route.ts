import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { MAX_UPLOAD_BYTES } from "@/server/storage";
import { safeDocument } from "@/server/serialize";
import { addDocument, documentMetaSchema, getOwnedSupplier } from "@/server/suppliers";

const blankToUndefined = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export const POST = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ req, current, meta }) => {
  // Refuse oversized bodies before buffering them.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 512 * 1024) throw new AppError("FILE_INVALID");

  const supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");

  const form = await req.formData().catch(() => {
    throw new AppError("BAD_REQUEST");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("FILE_INVALID");

  const meta2 = documentMetaSchema.parse({
    kind: blankToUndefined(form.get("kind")),
    number: blankToUndefined(form.get("number")),
    issuedAt: blankToUndefined(form.get("issuedAt")),
    expiresAt: blankToUndefined(form.get("expiresAt")),
  });
  const doc = await addDocument(current.user, supplier, meta, file, meta2);
  return { document: safeDocument(doc) };
});
