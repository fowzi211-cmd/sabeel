import { route } from "@/lib/http";
import { getJob } from "@/server/driver";

export const GET = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ params, current }) => ({ job: await getJob(current.user, params.id) }));
