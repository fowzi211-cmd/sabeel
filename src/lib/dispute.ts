// Pure rule for the dispute response window (design pack: OPENED → RESPONSE_DUE 48 h → UNDER_REVIEW).

export type ResponseState = "NONE" | "RESPONDED" | "AWAITING" | "MISSED";

/** NONE = this dispute has no response step (payment disputes, and disputes opened before slice 10). */
export function responseState(d: { responseDueAt: Date | null; supplierRespondedAt: Date | null }, now: Date = new Date()): ResponseState {
  if (!d.responseDueAt) return "NONE";
  if (d.supplierRespondedAt) return "RESPONDED";
  return now > d.responseDueAt ? "MISSED" : "AWAITING";
}
