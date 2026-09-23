import { parseJson, route } from "@/lib/http";
import { arrivedSchema, markArrived } from "@/server/driver";

export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ req, params, current, meta }) => {
  const input = await parseJson(req, arrivedSchema);
  return { job: await markArrived(current.user, params.id, input, meta) };
});
