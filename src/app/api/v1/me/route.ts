import { cookies } from "next/headers";
import { parseJson, route } from "@/lib/http";
import { profileSchema, publicUser, updateProfile } from "@/server/users";

export const GET = route({ allowMfaPending: true }, async ({ current }) => ({
  user: publicUser(current.user),
  mfaPending: current.mfaPending,
  mfaEnrolmentNeeded: current.mfaEnrolmentNeeded,
}));

export const PATCH = route({}, async ({ req, current, meta }) => {
  const patch = await parseJson(req, profileSchema);
  const updated = await updateProfile(current.user, patch, meta);
  if (patch.language) {
    (await cookies()).set("sabeel_lang", patch.language.toLowerCase(), {
      path: "/",
      sameSite: "lax",
      maxAge: 365 * 86_400,
    });
  }
  return { user: publicUser(updated) };
});
