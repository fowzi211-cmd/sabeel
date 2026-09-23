import { z } from "zod";
import { parseJson, route } from "@/lib/http";
import { startTrip } from "@/server/driver";

const schema = z.object({ clientAt: z.coerce.date().optional() });

/** T08. Safe to repeat: an offline retry never starts a second attempt. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, schema);
  return { job: await startTrip(current.user, params.id, input, meta) };
});
