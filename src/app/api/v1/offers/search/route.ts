import { parseJson, route } from "@/lib/http";
import { searchOffers, searchSchema } from "@/server/search";

/** Ranked comparison for a destination. The platform fee is never part of the price a buyer sees. */
export const POST = route({}, async ({ req }) => {
  const input = await parseJson(req, searchSchema);
  return { offers: await searchOffers(input) };
});
