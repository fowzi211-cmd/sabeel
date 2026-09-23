import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { safeDocument, safeSupplier } from "@/server/serialize";
import { buildChecklist, getSupplierForAdmin } from "@/server/suppliers";

export const GET = route<{ id: string }>({ roles: ["ADMIN_OPS", "ADMIN_SUPPORT"] }, async ({ params }) => {
  const supplier = await getSupplierForAdmin(params.id);
  if (!supplier) throw new AppError("NOT_FOUND");
  const owner = supplier.members.find((m) => m.role === "OWNER");
  const checklist = owner ? await buildChecklist(supplier, owner.userId) : null;
  const { documents, bankAccounts, members, acceptances, ...rest } = safeSupplier(supplier);
  return {
    supplier: rest,
    documents: documents.map(safeDocument),
    bankAccounts,
    members: members.map((m) => ({ role: m.role, user: m.user })),
    acceptances,
    checklist: checklist && {
      ...checklist,
      docs: checklist.docs.map((d) => ({ ...d, latest: d.latest ? safeDocument(d.latest) : null })),
    },
  };
});
