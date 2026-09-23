import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { safeDocument, safeSupplier } from "@/server/serialize";
import { buildChecklist, ensureBankActivation, getOwnedSupplier } from "@/server/suppliers";

export const GET = route({ roles: ["SUPPLIER_ADMIN"] }, async ({ current }) => {
  let supplier = await getOwnedSupplier(current.user.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  await ensureBankActivation(supplier.id);
  supplier = (await getOwnedSupplier(current.user.id))!;

  const checklist = await buildChecklist(supplier, current.user.id);
  const { documents, bankAccounts, ...rest } = safeSupplier(supplier);
  return {
    supplier: rest,
    documents: documents.map(safeDocument),
    bankAccounts,
    checklist: {
      ...checklist,
      docs: checklist.docs.map((d) => ({ ...d, latest: d.latest ? safeDocument(d.latest) : null })),
    },
  };
});
