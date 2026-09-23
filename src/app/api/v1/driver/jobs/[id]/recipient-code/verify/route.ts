import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { verifyRecipientCode } from "@/server/driver";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current }) => {
  const { code } = await parseJson(req, schema);
  return verifyRecipientCode(current.user, params.id, code);
});
