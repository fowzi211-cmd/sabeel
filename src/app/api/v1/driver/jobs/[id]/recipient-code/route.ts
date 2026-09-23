import { route } from "@/lib/http";
import { sendRecipientCode } from "@/server/driver";

/** N29: text a one-time code to the recipient. Limited sends per delivery. */
export const POST = route<{ id: string }>({ roles: ["DRIVER"] }, async ({ params, current, meta }) => sendRecipientCode(current.user, params.id, meta));
