// Buyer trust tiers (design pack R06). The supplier delivers before being paid, so a buyer's
// spending is capped until they have paid on time. All numbers are editable defaults that will
// move into admin settings.

export const TIER_CAPS_HALALAS: Record<1 | 2 | 3 | 4, number> = {
  1: 50_000, // SAR 500
  2: 200_000, // SAR 2,000
  3: 500_000, // SAR 5,000
  4: 1_500_000, // SAR 15,000
};

export type Tier = 1 | 2 | 3 | 4;

/** Tier from the number of orders paid on time. */
export function tierFor(paidOnTimeOrders: number): Tier {
  if (paidOnTimeOrders >= 10) return 4;
  if (paidOnTimeOrders >= 5) return 3;
  if (paidOnTimeOrders >= 2) return 2;
  return 1;
}

export const capForPaidCount = (paidOnTimeOrders: number): number => TIER_CAPS_HALALAS[tierFor(paidOnTimeOrders)];
