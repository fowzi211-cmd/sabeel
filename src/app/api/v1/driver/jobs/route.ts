import { route } from "@/lib/http";
import { listJobs } from "@/server/driver";

/** Everything the driver app needs, including full detail for open jobs so it can keep working offline. */
export const GET = route({ roles: ["DRIVER"] }, async ({ current }) => listJobs(current.user));
