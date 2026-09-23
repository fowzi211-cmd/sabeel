import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { acceptTerms } from "@/server/terms";

const schema = z.object({
  type: z.enum(["SUPPLIER_AGREEMENT", "INDEPENDENT_AGREEMENT", "BUYER_TERMS", "DRIVER_ACK"]),
  version: z.string().min(1).max(20),
  language: z.enum(["AR", "EN"]),
  confirmRead: z.boolean(),
  authorised: z.boolean().optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const POST = route({}, async ({ req, current, meta }) => {
  const body = await parseJson(req, schema);
  const acceptance = await acceptTerms({ user: current.user, ...body, meta });
  return {
    ok: true,
    certificateNo: acceptance.certificateNo,
    acceptedAt: acceptance.acceptedAt,
    version: acceptance.version,
    method: acceptance.method,
  };
});
